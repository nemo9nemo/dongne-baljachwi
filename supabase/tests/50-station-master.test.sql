-- ============================================================================
-- 50. 역 마스터 적재 — apply_station_master()
--
-- 근거: 02-station-master.md §2.1(5), §2.3, F-09/F-13, AC-02(멱등성)/AC-06(폐역)/AC-09/AC-10
--
-- 배치는 service_role 로 붙는다. service_role 은 RLS 를 우회하지만 **테이블 권한은
-- 우회하지 못하므로**, 이 파일은 마이그레이션의 GRANT 까지 함께 검증한다.
-- ============================================================================

select test.reset();

-- ── 권한 (F-13) ────────────────────────────────────────────────────────────

select test.signup('00000000-0000-0000-0000-0000000000c9', 'mallory@example.com');
select test.as_user('00000000-0000-0000-0000-0000000000c9');
set role authenticated;

select test.raises('F-13: 브라우저(authenticated)는 apply_station_master 를 실행할 수 없다',
  $q$select public.apply_station_master('{}'::jsonb)$q$,
  '42501');

reset role;
set role service_role;

-- ── 1회차 적재 ─────────────────────────────────────────────────────────────
-- S-0001 은 두 노선이 지나는 환승역이다 (is_transfer 파생 검증용).

select set_config('test.r', public.apply_station_master($j$
{
  "source": "tago",
  "source_updated_on": "2026-08-01",
  "lines": [
    {"code": "L-1001", "name": "1호선", "operator": "코레일", "sort_order": 1,
     "color_token": "line-1", "in_mvp_scope": true},
    {"code": "L-1002", "name": "2호선", "operator": "서울교통공사", "sort_order": 2,
     "color_token": "line-2", "in_mvp_scope": true}
  ],
  "stations": [
    {"code": "S-0001", "name": "홍대입구", "name_short": "홍대입구", "name_key": "홍대입구",
     "lat": 37.557, "lng": 126.925, "region_code": "11", "needs_review": false},
    {"code": "S-0002", "name": "합정", "name_short": "합정", "name_key": "합정",
     "lat": 37.549, "lng": 126.913, "region_code": "11", "needs_review": false},
    {"code": "S-0003", "name": "신촌", "name_short": "신촌", "name_key": "신촌",
     "lat": 37.555, "lng": 126.936, "region_code": "11", "needs_review": false}
  ],
  "station_lines": [
    {"station_code": "S-0001", "line_code": "L-1001", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925},
    {"station_code": "S-0002", "line_code": "L-1001", "station_no": "238", "seq": 2,
     "lat": 37.549, "lng": 126.913},
    {"station_code": "S-0001", "line_code": "L-1002", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925},
    {"station_code": "S-0003", "line_code": "L-1002", "station_no": "240", "seq": 2,
     "lat": 37.555, "lng": 126.936}
  ]
}
$j$::jsonb)::text, false);

-- 트랜잭션을 여기서 끊는다. apply_station_master 는 `create temp table ... on commit drop`
-- 을 쓰는데, 러너가 파일 전체를 한 트랜잭션으로 보내면 두 번째 호출에서 임시 테이블이 아직
-- 살아 있어 "relation _lines already exists" 로 죽는다. 실제 호출은 PostgREST RPC 1건 =
-- 트랜잭션 1건이므로 이 상황은 운영에서 발생하지 않는다 — 테스트 하네스 사정이다.
commit;

select test.eq('1회차: 노선 2건 신규',   current_setting('test.r')::jsonb ->> 'lines_inserted', '2');
select test.eq('1회차: 역 3건 신규',     current_setting('test.r')::jsonb ->> 'stations_inserted', '3');
select test.eq('1회차: 역-노선 4행 기록', current_setting('test.r')::jsonb ->> 'station_lines_written', '4');
select test.eq('F-09: master_version 이 1로 올라간다',
  current_setting('test.r')::jsonb ->> 'master_version', '1');

select test.eq('is_transfer 는 station_lines 개수(>=2)에서 파생된다',
  (select is_transfer::text from public.stations where code = 'S-0001'), 'true');
select test.eq('단일 노선 역은 환승역이 아니다',
  (select is_transfer::text from public.stations where code = 'S-0002'), 'false');

-- ── 2회차: 같은 페이로드 (AC-02 멱등성) ────────────────────────────────────
-- 값이 같으면 UPDATE 자체를 하지 않는다. 안 그러면 재실행마다 updated_at 만 바뀌고
-- master_version 이 올라 전 클라이언트가 마스터를 다시 내려받는다.

select set_config('test.before', (select value ->> 'version' from public.app_settings
  where key = 'master_version'), false);

select set_config('test.r', public.apply_station_master($j$
{
  "source": "tago",
  "source_updated_on": "2026-08-01",
  "lines": [
    {"code": "L-1001", "name": "1호선", "operator": "코레일", "sort_order": 1,
     "color_token": "line-1", "in_mvp_scope": true},
    {"code": "L-1002", "name": "2호선", "operator": "서울교통공사", "sort_order": 2,
     "color_token": "line-2", "in_mvp_scope": true}
  ],
  "stations": [
    {"code": "S-0001", "name": "홍대입구", "name_short": "홍대입구", "name_key": "홍대입구",
     "lat": 37.557, "lng": 126.925, "region_code": "11", "needs_review": false},
    {"code": "S-0002", "name": "합정", "name_short": "합정", "name_key": "합정",
     "lat": 37.549, "lng": 126.913, "region_code": "11", "needs_review": false},
    {"code": "S-0003", "name": "신촌", "name_short": "신촌", "name_key": "신촌",
     "lat": 37.555, "lng": 126.936, "region_code": "11", "needs_review": false}
  ],
  "station_lines": [
    {"station_code": "S-0001", "line_code": "L-1001", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925},
    {"station_code": "S-0002", "line_code": "L-1001", "station_no": "238", "seq": 2,
     "lat": 37.549, "lng": 126.913},
    {"station_code": "S-0001", "line_code": "L-1002", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925},
    {"station_code": "S-0003", "line_code": "L-1002", "station_no": "240", "seq": 2,
     "lat": 37.555, "lng": 126.936}
  ]
}
$j$::jsonb)::text, false);

commit;   -- 위와 같은 이유(임시 테이블 정리)

select test.eq('AC-02: 재실행 시 노선 변경 0건',
  (current_setting('test.r')::jsonb ->> 'lines_inserted') || '/' ||
  (current_setting('test.r')::jsonb ->> 'lines_updated'), '0/0');
select test.eq('AC-02: 재실행 시 역 변경 0건',
  (current_setting('test.r')::jsonb ->> 'stations_inserted') || '/' ||
  (current_setting('test.r')::jsonb ->> 'stations_updated'), '0/0');
select test.eq('AC-11: 변경이 없으면 master_version 을 올리지 않는다',
  current_setting('test.r')::jsonb ->> 'master_version', current_setting('test.before'));

-- ── 3회차: 원천에서 역이 사라진 경우 (AC-06) ───────────────────────────────

select set_config('test.r', public.apply_station_master($j$
{
  "source": "tago",
  "source_updated_on": "2026-08-02",
  "lines": [
    {"code": "L-1001", "name": "1호선", "operator": "코레일", "sort_order": 1,
     "color_token": "line-1", "in_mvp_scope": true},
    {"code": "L-1002", "name": "2호선", "operator": "서울교통공사", "sort_order": 2,
     "color_token": "line-2", "in_mvp_scope": true}
  ],
  "stations": [
    {"code": "S-0001", "name": "홍대입구", "name_short": "홍대입구", "name_key": "홍대입구",
     "lat": 37.557, "lng": 126.925, "region_code": "11", "needs_review": false},
    {"code": "S-0002", "name": "합정", "name_short": "합정", "name_key": "합정",
     "lat": 37.549, "lng": 126.913, "region_code": "11", "needs_review": false}
  ],
  "station_lines": [
    {"station_code": "S-0001", "line_code": "L-1001", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925},
    {"station_code": "S-0002", "line_code": "L-1001", "station_no": "238", "seq": 2,
     "lat": 37.549, "lng": 126.913},
    {"station_code": "S-0001", "line_code": "L-1002", "station_no": "239", "seq": 1,
     "lat": 37.557, "lng": 126.925}
  ]
}
$j$::jsonb)::text, false);

commit;   -- 위와 같은 이유(임시 테이블 정리)

select test.eq('AC-06: 사라진 역은 비활성화된다 (삭제가 아니다)',
  current_setting('test.r')::jsonb ->> 'stations_deactivated', '1');
select test.eq('AC-06: 행 자체는 남아 있다 — 기록이 참조 중일 수 있다',
  (select is_active::text from public.stations where code = 'S-0003'), 'false');
select test.eq('F-09: 변경이 있으면 master_version 이 올라간다',
  current_setting('test.r')::jsonb ->> 'master_version', '2');

-- ── 방어선 ─────────────────────────────────────────────────────────────────

select test.raises('빈 페이로드는 전량 비활성화 사고를 막기 위해 중단한다',
  $q$select public.apply_station_master('{"source":"tago","lines":[],"stations":[]}'::jsonb)$q$,
  'P0001', '%빈 페이로드%');

select test.raises('알 수 없는 source 는 거부한다',
  $q$select public.apply_station_master('{"source":"wikipedia"}'::jsonb)$q$,
  'P0001', '%unknown source%');

select test.eq('중단된 호출은 master_version 을 건드리지 않는다 (§2.3 롤백)',
  (select value ->> 'version' from public.app_settings where key = 'master_version'), '2');

-- ── 배치가 실제로 쓰는 다른 경로들 (scripts/load-station-master.mjs) ────────

with ins as (
  insert into public.station_source_raw (source, payload)
  values ('tago', '{"ok":true}'::jsonb)
  returning 1
)
select test.eq('F-15: 배치는 원천 응답 원문을 적재할 수 있다',
  (select count(*) from ins)::text, '1');

select test.eq('배치는 교정 규칙을 조회할 수 있다',
  (select count(*)::text from public.station_merge_overrides), '0');

select test.eq('배치는 기존 마스터를 조회할 수 있다 (재적재 전 비교)',
  (select count(*)::text from public.stations), '3');

reset role;
