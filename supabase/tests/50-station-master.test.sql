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

-- ── stations.in_mvp_scope: region_code 로 이 함수가 직접 계산한다 ──────────────────────
-- 근거: 02 §9 "MVP 범위의 정확한 경계" (2026-08-25 결정), 20260825100000_station_mvp_scope.sql.
-- 페이로드에는 in_mvp_scope 를 아예 넣지 않는다 — lines 와 달리 stations 는 이 필드를
-- 신뢰하지 않고 region_code 로만 재계산해야 한다. 위 카운트 어서션들 뒤(파일 맨 끝)에 둬서
-- 여기서 새로 넣는 역·노선이 앞선 "정확히 N건" 류 어서션에 영향을 주지 않게 한다.
-- L-1002 도 그대로 함께 보내 앞서 만든 노선이 이 호출로 비활성화되지 않게 한다(AC-06 경로
-- 오염 방지 — 이 테스트의 관심사가 아니다).

select set_config('test.r', public.apply_station_master($j$
{
  "source": "tago",
  "source_updated_on": "2026-08-03",
  "lines": [
    {"code": "L-1001", "name": "1호선", "operator": "코레일", "sort_order": 1,
     "color_token": "line-1", "in_mvp_scope": true},
    {"code": "L-1002", "name": "2호선", "operator": "서울교통공사", "sort_order": 2,
     "color_token": "line-2", "in_mvp_scope": true}
  ],
  "stations": [
    {"code": "S-0004", "name": "서울역", "name_short": "서울역", "name_key": "서울역",
     "lat": 37.556, "lng": 126.972, "region_code": "11", "needs_review": false},
    {"code": "S-0005", "name": "춘천역", "name_short": "춘천역", "name_key": "춘천역",
     "lat": 37.881, "lng": 127.720, "region_code": "51", "needs_review": false},
    {"code": "S-0006", "name": "미상역", "name_short": "미상역", "name_key": "미상역",
     "lat": 37.5, "lng": 127.0, "region_code": "00", "needs_review": true}
  ],
  "station_lines": [
    {"station_code": "S-0004", "line_code": "L-1001", "station_no": "1", "seq": 1,
     "lat": 37.556, "lng": 126.972},
    {"station_code": "S-0005", "line_code": "L-1001", "station_no": "2", "seq": 2,
     "lat": 37.881, "lng": 127.720},
    {"station_code": "S-0006", "line_code": "L-1001", "station_no": "3", "seq": 3,
     "lat": 37.5, "lng": 127.0}
  ]
}
$j$::jsonb)::text, false);

commit;   -- 위와 같은 이유(임시 테이블 정리)

select test.eq('02 §9: 서울(region_code=11)은 in_mvp_scope=true',
  (select in_mvp_scope::text from public.stations where code = 'S-0004'), 'true');
select test.eq('02 §9: 강원(region_code=51)은 소속 노선이 in_mvp_scope 여도 역 단위로 false',
  (select in_mvp_scope::text from public.stations where code = 'S-0005'), 'false');
select test.eq('02 §9: region_code 미상(00)도 "확인된 역내"가 아니므로 false',
  (select in_mvp_scope::text from public.stations where code = 'S-0006'), 'false');

select test.eq('station_master_public 뷰가 in_mvp_scope 를 그대로 노출한다',
  (select in_mvp_scope::text from public.station_master_public where code = 'S-0005'), 'false');

-- 재실행해도 region_code 가 그대로면 in_mvp_scope 도 그대로다 (AC-02 멱등성이 새 컬럼에도
-- 적용됨을 확인) — 이번엔 line 도 그대로라 변경 0건이어야 한다.
select set_config('test.r2', public.apply_station_master($j$
{
  "source": "tago",
  "source_updated_on": "2026-08-03",
  "lines": [
    {"code": "L-1001", "name": "1호선", "operator": "코레일", "sort_order": 1,
     "color_token": "line-1", "in_mvp_scope": true},
    {"code": "L-1002", "name": "2호선", "operator": "서울교통공사", "sort_order": 2,
     "color_token": "line-2", "in_mvp_scope": true}
  ],
  "stations": [
    {"code": "S-0004", "name": "서울역", "name_short": "서울역", "name_key": "서울역",
     "lat": 37.556, "lng": 126.972, "region_code": "11", "needs_review": false},
    {"code": "S-0005", "name": "춘천역", "name_short": "춘천역", "name_key": "춘천역",
     "lat": 37.881, "lng": 127.720, "region_code": "51", "needs_review": false},
    {"code": "S-0006", "name": "미상역", "name_short": "미상역", "name_key": "미상역",
     "lat": 37.5, "lng": 127.0, "region_code": "00", "needs_review": true}
  ],
  "station_lines": [
    {"station_code": "S-0004", "line_code": "L-1001", "station_no": "1", "seq": 1,
     "lat": 37.556, "lng": 126.972},
    {"station_code": "S-0005", "line_code": "L-1001", "station_no": "2", "seq": 2,
     "lat": 37.881, "lng": 127.720},
    {"station_code": "S-0006", "line_code": "L-1001", "station_no": "3", "seq": 3,
     "lat": 37.5, "lng": 127.0}
  ]
}
$j$::jsonb)::text, false);

commit;

select test.eq('AC-02: in_mvp_scope 도 재실행 시 역 변경 0건에 포함된다',
  (current_setting('test.r2')::jsonb ->> 'stations_inserted') || '/' ||
  (current_setting('test.r2')::jsonb ->> 'stations_updated'), '0/0');

reset role;
