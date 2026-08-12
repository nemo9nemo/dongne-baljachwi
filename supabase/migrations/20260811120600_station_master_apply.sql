-- ============================================================================
-- apply_station_master(): 역 마스터 적재를 단일 트랜잭션으로 수행하는 RPC
--
-- 근거: docs/specs/02-station-master.md §2.1(5) "트랜잭션 1건으로 upsert →
--       master_version 증가", §2.3 "배치 도중 실패 → 롤백, master_version 불변",
--       F-09, AC-02(멱등성), AC-06(폐역은 삭제 금지), AC-07
--
-- 왜 배치 스크립트가 직접 upsert 하지 않고 RPC 를 두는가:
-- supabase-js(PostgREST)는 여러 요청을 하나의 트랜잭션으로 묶을 수 없다. lines →
-- stations → station_lines 를 따로 호출하면 중간 실패 시 "노선은 갱신됐는데 역은 안 된"
-- 상태가 남는다. 요청 1건 = 트랜잭션 1건이므로, 전체 스냅샷을 한 번에 넘긴다.
-- (역 1,073 + 노선 25 + 역-노선 1,100 규모라 페이로드는 수백 KB 수준이다.)
--
-- 호출 권한은 service_role 뿐이다 (F-13).
-- ============================================================================

create or replace function public.apply_station_master(p_payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_source     text := p_payload ->> 'source';
  v_updated_on date := nullif(p_payload ->> 'source_updated_on', '')::date;

  v_lines_ins int := 0;  v_lines_upd int := 0;  v_lines_off int := 0;
  v_st_ins    int := 0;  v_st_upd    int := 0;  v_st_off    int := 0;
  v_sl_rows   int := 0;  v_transfer  int := 0;
  v_version   int;
begin
  if v_source is null or v_source not in ('tago', 'standard-file') then
    raise exception 'apply_station_master: unknown source %', coalesce(v_source, '(null)');
  end if;

  -- 원천 스냅샷을 임시 테이블로 펼친다. on commit drop 이라 트랜잭션이 끝나면 사라진다.
  create temp table _lines on commit drop as
  select * from jsonb_to_recordset(coalesce(p_payload -> 'lines', '[]'::jsonb))
    as x(code text, name text, operator text, sort_order smallint,
         color_token text, in_mvp_scope boolean);

  create temp table _stations on commit drop as
  select * from jsonb_to_recordset(coalesce(p_payload -> 'stations', '[]'::jsonb))
    as x(code text, name text, name_short text, name_key text,
         lat double precision, lng double precision, region_code text, needs_review boolean);

  create temp table _slines on commit drop as
  select * from jsonb_to_recordset(coalesce(p_payload -> 'station_lines', '[]'::jsonb))
    as x(station_code text, line_code text, station_no text, seq int,
         lat double precision, lng double precision);

  -- 빈 페이로드가 들어오면 아래 비활성화 단계가 전 노선·전 역을 내려버린다.
  -- 원천 수집이 조용히 0건을 반환하는 사고(응답 포맷 변경 등)에 대한 최후 방어선이다.
  if (select count(*) from _lines) = 0 or (select count(*) from _stations) = 0 then
    raise exception 'apply_station_master: 빈 페이로드 — 전량 비활성화 사고를 막기 위해 중단한다';
  end if;

  -- ── lines ──────────────────────────────────────────────────────────────
  -- DO UPDATE 에 WHERE 를 걸어 값이 같으면 아예 쓰지 않는다. 이것이 AC-02(멱등성)의
  -- 실질적 근거다 — 안 그러면 재실행마다 updated_at 만 바뀌어 "변경 0건"이 성립하지 않는다.
  -- xmax = 0 은 이번 INSERT 로 새로 생긴 행을 구분하는 관용구다.
  with ins as (
    insert into public.lines (code, name, operator, sort_order, color_token, in_mvp_scope, is_active)
    select l.code, l.name, l.operator, coalesce(l.sort_order, 0::smallint),
           l.color_token, coalesce(l.in_mvp_scope, true), true
    from _lines l
    on conflict (code) do update
      set name = excluded.name, operator = excluded.operator, sort_order = excluded.sort_order,
          color_token = excluded.color_token, in_mvp_scope = excluded.in_mvp_scope, is_active = true
      where (public.lines.name, public.lines.operator, public.lines.sort_order,
             public.lines.color_token, public.lines.in_mvp_scope, public.lines.is_active)
        is distinct from
            (excluded.name, excluded.operator, excluded.sort_order,
             excluded.color_token, excluded.in_mvp_scope, excluded.is_active)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_lines_ins, v_lines_upd from ins;

  -- AC-06: 원천에서 사라져도 삭제하지 않는다. 기록이 참조 중일 수 있다.
  update public.lines l set is_active = false
   where l.is_active and not exists (select 1 from _lines s where s.code = l.code);
  get diagnostics v_lines_off = row_count;

  -- ── stations ───────────────────────────────────────────────────────────
  with ins as (
    insert into public.stations
      (code, name, name_short, name_key, lat, lng, region_code,
       needs_review, source, source_updated_on, is_active)
    select s.code, s.name, s.name_short, s.name_key, s.lat, s.lng, s.region_code,
           coalesce(s.needs_review, false), v_source, v_updated_on, true
    from _stations s
    on conflict (code) do update
      set name = excluded.name, name_short = excluded.name_short, name_key = excluded.name_key,
          lat = excluded.lat, lng = excluded.lng, region_code = excluded.region_code,
          needs_review = excluded.needs_review, source = excluded.source,
          source_updated_on = excluded.source_updated_on, is_active = true
      where (public.stations.name, public.stations.name_short, public.stations.name_key,
             public.stations.lat, public.stations.lng, public.stations.region_code,
             public.stations.needs_review, public.stations.source,
             public.stations.source_updated_on, public.stations.is_active)
        is distinct from
            (excluded.name, excluded.name_short, excluded.name_key,
             excluded.lat, excluded.lng, excluded.region_code,
             excluded.needs_review, excluded.source,
             excluded.source_updated_on, excluded.is_active)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_st_ins, v_st_upd from ins;

  update public.stations st set is_active = false
   where st.is_active and not exists (select 1 from _stations s where s.code = st.code);
  get diagnostics v_st_off = row_count;

  -- ── station_lines ──────────────────────────────────────────────────────
  -- upsert 대신 "해당 노선 전량 삭제 후 재삽입"을 택했다. seq 가 서로 맞바뀌는 갱신
  -- (지선 연장 등)에서 UNIQUE (line_id, seq) 가 중간 상태에 걸려 실패하기 때문이다.
  -- station_lines 를 참조하는 FK 가 없어 삭제가 안전하고, 페이로드가 전량 스냅샷이라
  -- 이 방식이 곧 정확한 최종 상태를 만든다.
  delete from public.station_lines sl
   using public.lines l
   where sl.line_id = l.id
     and exists (select 1 from _lines s where s.code = l.code);

  insert into public.station_lines (station_id, line_id, station_no, seq, lat, lng)
  select st.id, l.id, s.station_no, s.seq, s.lat, s.lng
  from _slines s
  join public.stations st on st.code = s.station_code
  join public.lines    l  on l.code  = s.line_code;
  get diagnostics v_sl_rows = row_count;

  -- is_transfer 는 station_lines 개수에서 파생된 물리화 컬럼이다. 적재 끝에 다시 맞춘다.
  update public.stations s set is_transfer = t.is_transfer
  from (
    select st.id, count(sl.line_id) >= 2 as is_transfer
    from public.stations st
    left join public.station_lines sl on sl.station_id = st.id
    group by st.id
  ) t
  where t.id = s.id and s.is_transfer is distinct from t.is_transfer;
  get diagnostics v_transfer = row_count;

  -- ── master_version (F-09) ──────────────────────────────────────────────
  -- 변경이 하나도 없으면 올리지 않는다. 무의미하게 올리면 전 클라이언트가 마스터를
  -- 다시 내려받는다 (AC-11 과 정면 충돌).
  if v_lines_ins + v_lines_upd + v_lines_off + v_st_ins + v_st_upd + v_st_off + v_transfer > 0 then
    update public.app_settings
       set value = json_build_object(
             'version', coalesce((value ->> 'version')::int, 0) + 1,
             'applied_at', now()
           )::jsonb
     where key = 'master_version'
    returning (value ->> 'version')::int into v_version;
  else
    select (value ->> 'version')::int into v_version
    from public.app_settings where key = 'master_version';
  end if;

  return json_build_object(
    'lines_inserted',        v_lines_ins,
    'lines_updated',         v_lines_upd,
    'lines_deactivated',     v_lines_off,
    'stations_inserted',     v_st_ins,
    'stations_updated',      v_st_upd,
    'stations_deactivated',  v_st_off,
    'station_lines_written', v_sl_rows,
    'transfer_recomputed',   v_transfer,
    'master_version',        v_version
  )::jsonb;
end;
$$;

comment on function public.apply_station_master(jsonb) is
  '역 마스터 전량 스냅샷을 단일 트랜잭션으로 적재하고 master_version 을 올린다 (02 §2.1, F-09). service_role 전용.';

-- F-13: 배치 전용. 브라우저에서 실행 불가.
revoke all on function public.apply_station_master(jsonb) from public, anon, authenticated;
grant execute on function public.apply_station_master(jsonb) to service_role;
