-- ============================================================================
-- MVP 범위(in_mvp_scope) 판정을 노선 단위(lines)에서 역 단위(stations)로 보강
--
-- 근거: docs/specs/02-station-master.md §9 "MVP 범위의 정확한 경계"
--       (2026-08-25 planner 결정 — in_mvp_scope = region_code 기준 "서울+인천+경기"),
--       docs/PROGRESS.md 표3 No.9
--
-- ── 왜 lines.in_mvp_scope 를 고치는 게 아니라 stations 에 새 컬럼을 추가하는가 ──────────
-- F-10 은 "MVP 범위는 lines.in_mvp_scope 로 정한다"고 했고, 09-couple-profile.md F-09 도
-- "커버리지 분모는 lines.in_mvp_scope=true 에 속한 is_active=true 역의 distinct 개수"라고
-- 정의해 뒀다. 이 값은 scripts/station-master/line-policy.mjs 의 applyMvpScope() 가
-- "노선이 수도권 역을 하나라도 포함하면 true"(OR 집계)로 계산해서 적재한다.
--
-- 문제는 1호선(L-I4101)·경춘선(L-I41K2)처럼 **한 노선이 서울/인천/경기와 그 바깥을 동시에
-- 지나는 경우**다. OR 집계 특성상 이런 "혼합 노선"은 지역 밖 역이 몇 개든 상관없이 항상
-- true 로 남는다. 실측(2026-08-25, station_lines + lines + stations 전수 조인)으로 확인한
-- 누수는 다음 9역이다 — 전부 지금 in_mvp_scope=true 인 노선에 속해 있어 커버리지 %
-- 분모(F-09)·"안 가본 역" 추천 후보(09 F-14)에 잘못 포함되고 있었다:
--   1호선(L-I4101, 충남):   성환역(S-I4101-1725) 직산역(S-I4101-1726) 두정역(S-I4101-1727)
--   경춘선(L-I41K2, 강원):  굴봉산역 백양리역 강촌역 김유정역 남춘천역 춘천역
--                          (S-I41K2-1324~1329)
--
-- lines.in_mvp_scope 자체를 이 두 노선만 false 로 뒤집는 건 정답이 아니다 — 1호선은 여전히
-- 44개, 경춘선은 여전히 14개의 정상 수도권 역을 갖고 있어서, 뒤집으면 그 역들까지 통째로
-- 커버리지·추천에서 사라진다(정정보다 큰 회귀). 노선 단위 불리언 하나로는 애초에 "한 노선
-- 안에서 일부 역만 빼기"를 표현할 수 없다 — 그래서 stations 에 자체 플래그를 둔다.
--
-- (station_master_public 뷰가 이미 stations.region_code 를 클라이언트에 그대로 노출하므로
-- (02 §6), 프론트가 region_code 를 직접 비교해 우회할 수도 있었지만, 그러면 "서울+인천+경기"
-- 라는 정책값이 이 배치(SQL)와 프론트 두 군데에 따로 박힌다. F-08/F-10 의 "데이터가 정하고
-- 코드가 정하지 않는다" 원칙을 지키려면 이 판정도 데이터(DB)가 내려줘야 한다 — 그래서 여기
-- SQL 한 곳에서만 계산하고 컬럼으로 저장한다.)
--
-- ⚠ 계약 변경 필요 (developer-frontend 후속 작업, 보고 대상):
-- 이 컬럼은 추가·계산될 뿐 아직 어떤 프론트 코드도 읽지 않는다.
-- src/screens/profile/ProfileScreen.tsx(F-09 분모 계산)·src/lib/station-recommendation.ts
-- (F-14 후보 집합)는 여전히 `lines.in_mvp_scope` 만 본다 — 이 마이그레이션만으로는 사용자
-- 화면의 커버리지 %·추천 결과가 아직 바뀌지 않는다. 두 소비처가
-- `station_master_public.in_mvp_scope` 를 함께 보도록(또는 이것으로 대체하도록) 바꿔야
-- 실제로 반영된다. 09-couple-profile.md F-09 문구("lines.in_mvp_scope=true 에 속한")도
-- 이 사실과 어긋나므로 planner 확인이 필요하다 — 이 마이그레이션에서 스펙 문구 자체를
-- 임의로 고치지 않았다(계약은 혼자 바꾸지 않는다, CLAUDE.md).
--
-- 계산 규칙: stations.in_mvp_scope = region_code in ('11','28','41'). region_code 를 못 뽑아
-- '00'으로 적재된(needs_review=true) 행은 "확인 안 됨"이지 "확인된 역외"가 아니므로, 원칙대로면
-- 이 규칙에서도 false 가 된다 — 다만 이번 전수 스캔 중 그중 2건(동구릉역/장자호수공원역,
-- 별내선)은 좌표 실측으로 경기도(구리시/남양주시)임을 확인했으므로 STEP 2a 에서 region_code
-- 자체를 41 로 먼저 바로잡는다(재적재 시 재발 방지는
-- scripts/station-master/known-corrections.mjs 에 반영됨). 나머지 ~86건의 '00' 행은 이번
-- 조사 범위 밖으로 그대로 둔다(양원역 마이그레이션 때 이미 "알려진 한계"로 기록됨, 02 §9).
-- ============================================================================

-- ── STEP 1. stations.in_mvp_scope 컬럼 추가 ────────────────────────────────────────────
alter table public.stations
  add column if not exists in_mvp_scope boolean not null default true;

comment on column public.stations.in_mvp_scope is
  'MVP(수도권) 범위 여부. region_code in (11 서울/28 인천/41 경기) 로 계산한다 (02 §9,
   2026-08-25 결정). lines.in_mvp_scope(노선 단위 OR 집계, F-10)와 별개다 — 한 노선이 수도권
   안팎을 동시에 지나면(1호선·경춘선) 노선 단위 플래그만으로는 표현이 안 돼 역 단위로 둔다.';

-- ── STEP 2. 데이터 정정 + master_version 갱신 ──────────────────────────────────────────
-- 두 UPDATE 의 실제 변경 건수를 합산해, 뭔가 바뀌었을 때만 master_version 을 올린다
-- (F-09, 재실행해도 변경 0건이면 그대로 — 무의미하게 올리면 전 클라이언트가 마스터를
-- 다시 내려받아 AC-11 과 충돌한다). "지금 막 바뀐 행"을 시각 비교 같은 방식으로 추정하지
-- 않고 GET DIAGNOSTICS 로 정확히 센다(양원역 마이그레이션과 같은 관용구).
do $$
declare
  v_region_fixed int;
  v_scope_changed int;
begin
  -- STEP 2a. 별내선 2역의 region_code 정정 (needs_review='00'→'41', 부수 발견).
  -- 좌표(37.610556,127.135056 / 37.587222,127.13793)가 각각 경기도 구리시 인창동(동구릉)·
  -- 남양주시 다산동(장자호수공원)과 일치함을 확인했다. 원본 좌표 자체는 정확했다 — 주소
  -- 앞머리에 시/도명이 없는 형태("인창동 679-8 일원" 류)라 regionCodeFromAddress() 가
  -- 지역을 못 뽑은 것뿐이다(양원역처럼 원본 좌표 오류가 아니라 이 배치의 파싱 한계).
  -- 로컬 검증(PGlite)에는 이 두 역이 없어 v_region_fixed = 0 으로 스킵된다 — 의도된 동작.
  update public.stations
     set region_code = '41',
         needs_review = false
   where code in ('S-S1108-806', 'S-S1108-808')
     and region_code is distinct from '41';
  get diagnostics v_region_fixed = row_count;

  -- STEP 2b. in_mvp_scope 전체 재계산. ADD COLUMN 의 DEFAULT true 는 새로 추가되는 컬럼의
  -- 초기값일 뿐이라, region_code 가 이미 수도권 밖인 ~300행(부산·대구 등 비수도권 노선)과
  -- 1호선·경춘선의 역외 9역(+STEP 2a 로 방금 41 이 된 별내선 2역 포함)이 이 UPDATE 로
  -- 정확히 재계산된다. WHERE 가드가 있어 재실행해도 이미 맞는 행은 다시 쓰지 않는다.
  update public.stations
     set in_mvp_scope = (region_code in ('11', '28', '41'))
   where in_mvp_scope is distinct from (region_code in ('11', '28', '41'));
  get diagnostics v_scope_changed = row_count;

  if v_region_fixed + v_scope_changed > 0 then
    update public.app_settings
       set value = jsonb_build_object(
             'version', coalesce((value ->> 'version')::int, 0) + 1,
             'applied_at', now()
           )
     where key = 'master_version';
    raise notice 'STEP 2: region_code 정정 % 건 / in_mvp_scope 재계산 % 건 — master_version 증가',
      v_region_fixed, v_scope_changed;
  end if;
end $$;

-- ── STEP 3. station_master_public 뷰에 노출 ────────────────────────────────────────────
-- 09(couple-profile)·03(line-map) 소비처가 station 단위 스코프를 쓰려면 이 뷰에서
-- 받아야 한다(02 §6, 클라이언트는 이 뷰만 읽는다). security_invoker 는 원본과 동일하게
-- 유지 — stations 의 RLS(authenticated 전원 SELECT)를 그대로 따른다.
create or replace view public.station_master_public
with (security_invoker = true) as
select
  s.id,
  s.code,
  s.name,
  s.name_short,
  s.lat,
  s.lng,
  s.region_code,
  s.is_transfer,
  s.is_active,
  s.in_mvp_scope
from public.stations s;

comment on view public.station_master_public is
  '마스터 캐시 전송용 축소 뷰 (02 §6). 운영 전용 컬럼을 제외한다. in_mvp_scope 는 02 §9
   역 단위 MVP 판정(2026-08-25 결정) 컬럼이다.';

-- 뷰는 CREATE OR REPLACE 로 다시 만들어도 기존 GRANT(20260811120200_station_master.sql)가
-- 유지된다 — 컬럼만 추가된 동일 오브젝트라 재부여할 필요가 없다.
--
-- 다만 원래 GRANT 는 authenticated 전용이었고 service_role 은 빠져 있었다(배치가 이 뷰를
-- 직접 쓴 적이 없어 지금까지 드러나지 않은 gap). stations 테이블 자체는 이미 service_role
-- 에 select 가 부여돼 있으므로(같은 마이그레이션), 그 부분집합인 이 뷰도 막을 이유가 없다
-- — 여기서 명시적으로 채운다(50-station-master.test.sql 이 이 gap 을 실제로 잡아냈다).
grant select on public.station_master_public to service_role;

-- ── STEP 4. apply_station_master(): 재적재 때마다 region_code 로 다시 계산 ────────────────
-- 배치 페이로드(_stations 임시테이블)에 in_mvp_scope 를 새로 추가하지 않는다 — "서울/인천/
-- 경기"라는 정책값을 SQL 한 곳(여기)에서만 들고, JS 배치 쪽(line-policy.mjs)의 MVP_REGIONS
-- 와는 노선 단위 OR 집계용으로 별도 유지한다(위 배경 설명 참고, 상호 주석 참조 있음).
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
  -- in_mvp_scope 는 페이로드가 아니라 region_code 에서 이 함수가 직접 계산한다(02 §9,
  -- 2026-08-25) — "서울/인천/경기" 판정 기준을 배치 스크립트가 아니라 DB 한 곳에 둔다.
  with ins as (
    insert into public.stations
      (code, name, name_short, name_key, lat, lng, region_code,
       needs_review, source, source_updated_on, is_active, in_mvp_scope)
    select s.code, s.name, s.name_short, s.name_key, s.lat, s.lng, s.region_code,
           coalesce(s.needs_review, false), v_source, v_updated_on, true,
           (s.region_code in ('11', '28', '41'))
    from _stations s
    on conflict (code) do update
      set name = excluded.name, name_short = excluded.name_short, name_key = excluded.name_key,
          lat = excluded.lat, lng = excluded.lng, region_code = excluded.region_code,
          needs_review = excluded.needs_review, source = excluded.source,
          source_updated_on = excluded.source_updated_on, is_active = true,
          in_mvp_scope = excluded.in_mvp_scope
      where (public.stations.name, public.stations.name_short, public.stations.name_key,
             public.stations.lat, public.stations.lng, public.stations.region_code,
             public.stations.needs_review, public.stations.source,
             public.stations.source_updated_on, public.stations.is_active,
             public.stations.in_mvp_scope)
        is distinct from
            (excluded.name, excluded.name_short, excluded.name_key,
             excluded.lat, excluded.lng, excluded.region_code,
             excluded.needs_review, excluded.source,
             excluded.source_updated_on, excluded.is_active, excluded.in_mvp_scope)
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
  '역 마스터 전량 스냅샷을 단일 트랜잭션으로 적재하고 master_version 을 올린다 (02 §2.1, F-09).
   stations.in_mvp_scope 는 region_code 로 이 함수가 직접 계산한다 (02 §9, 2026-08-25).
   service_role 전용.';

-- F-13: 배치 전용. 브라우저에서 실행 불가. CREATE OR REPLACE 는 기존 함수를 대체할 뿐이라
-- REVOKE/GRANT 를 다시 걸 필요는 없지만(오브젝트 identity 불변), 명시적으로 재확인해 둔다.
revoke all on function public.apply_station_master(jsonb) from public, anon, authenticated;
grant execute on function public.apply_station_master(jsonb) to service_role;

-- master_version 갱신은 STEP 2 의 do 블록이 이미 처리했다(region_code 정정·in_mvp_scope
-- 백필 건수를 정확히 세어 변경이 있을 때만 올림) — 여기서 별도로 다시 올리지 않는다.
