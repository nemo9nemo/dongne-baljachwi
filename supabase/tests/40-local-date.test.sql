-- ============================================================================
-- 40. 로컬 날짜(KST) vs 서버 날짜(UTC) — QA Major 2 회귀 테스트
--
-- 재현하려던 사고:
--   Supabase DB 세션은 UTC 다. 클라이언트(OnboardingScreen)는 브라우저 로컬(KST=UTC+9)로
--   "오늘"을 계산해 date input 의 max 로 준다. KST 00:00~08:59 에는 사용자의 "오늘"이
--   서버 current_date 기준으로 **내일**이라, `<= current_date` 로 검증하면 매일 새벽 9시간
--   동안 정상 입력이 INVALID_START_DATE / check violation 으로 거부된다.
--
-- 고친 방향 (00 D-13 "서버 타임존 의존 로직은 클라이언트가 계산한다"):
--   서버는 "오늘"을 판정하지 않는다. 서버 제약은 오타·장난 입력을 막는 상한(current_date + 1)
--   으로만 쓰고, 정확한 상한은 클라이언트가 준다. +1일이면 최대 UTC+14 타임존까지 커버된다.
--
-- 이 파일의 어서션은 실행 시각과 무관하게 결정적이다: "KST 새벽에 클라이언트가 보내는 값"은
-- 곧 `current_date + 1` 이므로, 시계를 조작하지 않고도 같은 조건을 만들 수 있다.
-- ============================================================================

select test.reset();

-- Supabase 와 동일한 세션 타임존. (스텁이 이미 UTC 지만, 이 파일의 전제라 명시한다.)
set timezone = 'UTC';

select test.signup('00000000-0000-0000-0000-0000000000d1', 'dawn1@example.com');
select test.signup('00000000-0000-0000-0000-0000000000d2', 'dawn2@example.com');
select test.signup('00000000-0000-0000-0000-0000000000d3', 'dawn3@example.com');

-- ── 1. couples 제약 (20260811120000_core_identity.sql) ──────────────────────

with ins as (
  insert into public.couples (started_on, created_by)
  values (current_date + 1, '00000000-0000-0000-0000-0000000000d1')
  returning 1
)
select test.eq(
  'couples_started_on_not_future: KST 새벽의 "오늘"(= UTC 기준 내일)을 허용한다',
  (select count(*) from ins)::text, '1');

select test.raises(
  'couples_started_on_not_future: 이틀 뒤는 여전히 거부한다 (상한이 사라진 게 아니다)',
  format('insert into public.couples (started_on, created_by) values (%L, %L)',
         current_date + 2, '00000000-0000-0000-0000-0000000000d1'),
  '23514');

-- 오늘/과거는 당연히 허용되어야 한다 (회귀 방지용 기준선).
with ins as (
  insert into public.couples (started_on, created_by)
  values (current_date - 3650, '00000000-0000-0000-0000-0000000000d1')
  returning 1
)
select test.eq('couples_started_on_not_future: 과거 날짜 허용',
  (select count(*) from ins)::text, '1');

-- 위에서 만든 멤버 없는 커플들은 아래 create_couple 검사(ALREADY_IN_COUPLE)와 무관하지만,
-- 남겨두면 뒤의 current_couple_id() 조회가 어느 커플을 가리키는지 헷갈린다. 정리한다.
delete from public.couples;

-- ── 2. create_couple() (20260811120100_couple_link.sql) ─────────────────────

-- 여기서부터는 브라우저와 같은 조건(authenticated 롤 + JWT sub)으로 실행한다.
select test.as_user('00000000-0000-0000-0000-0000000000d1');
set role authenticated;

-- ★ 핵심 재현: KST 새벽 2시 사용자가 date input 에서 고른 "오늘"을 그대로 보낸 경우.
--   고치기 전에는 여기서 INVALID_START_DATE 로 거부됐다. 실패하면 함수가 예외를 던지므로
--   이 문장 자체가 파일을 중단시킨다 = 러너가 큰 소리로 실패를 알린다.
select test.ok(
  'F-07: KST 새벽에 고른 "오늘"(UTC 기준 내일)로 커플 생성이 성공한다',
  (public.create_couple(current_date + 1, '새벽이') ->> 'couple_id') is not null);

-- 함수와 제약의 상한이 어긋나면 "제약은 통과하는데 함수는 거부"하는 모순이 생긴다.
select test.as_user('00000000-0000-0000-0000-0000000000d2');
select test.raises(
  'F-07: create_couple 은 이틀 뒤 날짜를 INVALID_START_DATE 로 거부한다',
  format('select public.create_couple(%L::date, %L)', current_date + 2, '미래인'),
  'P0001', '%INVALID_START_DATE%');

-- ── 3. records 제약 (20260811120300_records.sql) ────────────────────────────
-- 05-record-editor 는 다음 라운드지만 같은 결함이라 지금 함께 막았다.

select test.as_user('00000000-0000-0000-0000-0000000000d1');
select test.seed_station('S-0001', '테스트역');

with ins as (
  insert into public.records (couple_id, station_id, visited_on, author_id)
  select public.current_couple_id(), s.id, current_date + 1,
         '00000000-0000-0000-0000-0000000000d1'
  from public.stations s where s.code = 'S-0001'
  returning 1
)
select test.eq('records_visited_on_not_future: KST 새벽의 "오늘" 방문 기록을 허용한다',
  (select count(*) from ins)::text, '1');

select test.raises(
  'records_visited_on_not_future: 이틀 뒤 방문은 거부한다',
  format($q$insert into public.records (couple_id, station_id, visited_on, author_id)
            select public.current_couple_id(), s.id, %L::date, %L
            from public.stations s where s.code = 'S-0001'$q$,
         current_date + 2, '00000000-0000-0000-0000-0000000000d1'),
  '23514');

-- ── 4. 불변식 ──────────────────────────────────────────────────────────────
-- 실행 시각이 언제든(새벽이든 아니든) 성립해야 하는 성질. 이게 깨지면 어떤 타임존
-- 보정을 해도 사용자가 자기 "오늘"을 저장할 수 없다.
select test.ok(
  'KST 로컬 "오늘"은 항상 서버 상한(current_date + 1) 이하다',
  (now() at time zone 'Asia/Seoul')::date <= current_date + 1);

-- 지구상 최대 오프셋(UTC+14)까지 같은 성질이 성립한다 → 해외 사용자도 거부되지 않는다.
select test.ok(
  'UTC+14 로컬 "오늘"도 서버 상한 이하다',
  (now() at time zone 'Pacific/Kiritimati')::date <= current_date + 1);

reset role;
