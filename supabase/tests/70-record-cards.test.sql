-- ============================================================================
-- 70. 목록 카드 뷰 record_cards
--
-- 근거: 04-station-detail.md §4.1(일기 앞 200자만 전송), 00-data-model.md §4.9(D-12)
--
-- 픽스처
--   커플 A(...00aa): alice(...00a1)  — 기록 r1(...0071, 긴 일기 600자, S-0001)
--                                      기록 r2(...0072, 일기 NULL, S-0002)
--                                      기록 r3(...0073, 짧은 일기 5자, S-0001)
--   커플 B(...00bb): carol(...00b1)  — 기록 rb(...0079, 일기 있음) ← 격리 검증용 미끼
-- ============================================================================

select test.reset();

select test.signup('00000000-0000-0000-0000-0000000000a1', 'alice@example.com');
select test.signup('00000000-0000-0000-0000-0000000000b1', 'carol@example.com');

insert into public.couples (id, started_on, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', current_date - 100, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000bb', current_date - 100, '00000000-0000-0000-0000-0000000000b1');

insert into public.couple_members (couple_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'owner');

select test.seed_station('S-0001', '홍대입구');
select test.seed_station('S-0002', '합정');

insert into public.records (id, couple_id, station_id, visited_on, note, author_id)
select '00000000-0000-0000-0000-000000000071',
       '00000000-0000-0000-0000-0000000000aa', s.id, current_date - 3,
       repeat('가', 600), '00000000-0000-0000-0000-0000000000a1'
from public.stations s where s.code = 'S-0001';

insert into public.records (id, couple_id, station_id, visited_on, note, author_id)
select '00000000-0000-0000-0000-000000000072',
       '00000000-0000-0000-0000-0000000000aa', s.id, current_date - 2,
       null, '00000000-0000-0000-0000-0000000000a1'
from public.stations s where s.code = 'S-0002';

insert into public.records (id, couple_id, station_id, visited_on, note, author_id)
select '00000000-0000-0000-0000-000000000073',
       '00000000-0000-0000-0000-0000000000aa', s.id, current_date - 1,
       '짧은일기', '00000000-0000-0000-0000-0000000000a1'
from public.stations s where s.code = 'S-0001';

-- 커플 B 의 기록 (뷰가 RLS 를 상속하는지 확인할 미끼).
insert into public.records (id, couple_id, station_id, visited_on, note, author_id)
select '00000000-0000-0000-0000-000000000079',
       '00000000-0000-0000-0000-0000000000bb', s.id, current_date - 1,
       '남의 일기', '00000000-0000-0000-0000-0000000000b1'
from public.stations s where s.code = 'S-0001';

-- ── 계약: 뷰가 노출하는 컬럼 ────────────────────────────────────────────────

select test.eq('record_cards 는 note 전문 컬럼을 노출하지 않는다',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'record_cards' and column_name = 'note'),
  '0');

select test.eq('record_cards 의 컬럼 집합이 계약(04 §4.1)과 일치한다',
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'record_cards'),
  'id,station_id,visited_on,mood,weather,note_excerpt,author_id');

-- D-12 의 사고 지점. 기능 검증(아래 격리 테스트)과 별개로 옵션 자체를 못박아 둔다.
select test.eq('D-12: record_cards 는 security_invoker = true',
  (select case when 'security_invoker=true' = any(c.reloptions) then 'true' else 'false' end
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'record_cards'),
  'true');

-- ── alice 로 로그인 ────────────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

-- ── 04 §4.1: 서버가 200자로 자른다 ─────────────────────────────────────────

select test.eq('04 §4.1: 600자 일기는 note_excerpt 200자로 잘려 나온다',
  (select char_length(note_excerpt)::text from public.record_cards
    where id = '00000000-0000-0000-0000-000000000071'),
  '200');

select test.eq('04 §4.1: 잘린 값은 앞 200자다 (바이트가 아니라 문자 단위)',
  (select note_excerpt from public.record_cards
    where id = '00000000-0000-0000-0000-000000000071'),
  repeat('가', 200));

select test.eq('200자 이하 일기는 그대로 나온다',
  (select note_excerpt from public.record_cards
    where id = '00000000-0000-0000-0000-000000000073'),
  '짧은일기');

select test.ok('일기가 NULL 이면 note_excerpt 도 NULL ("일기 없음"과 "빈 일기"를 구분)',
  (select note_excerpt is null from public.record_cards
    where id = '00000000-0000-0000-0000-000000000072'));

-- ── RLS 상속 (D-12) ────────────────────────────────────────────────────────

select test.eq('필터 없이 조회해도 내 커플 기록 3건만 보인다',
  (select count(*)::text from public.record_cards), '3');

select test.eq('다른 커플의 기록은 id 를 직접 지정해도 0행',
  (select count(*)::text from public.record_cards
    where id = '00000000-0000-0000-0000-000000000079'), '0');

-- ── 목록 접근 패턴 (F-06 키셋 + 04 의 역 필터) ─────────────────────────────

select test.eq('역 필터: station_id 로 좁히면 해당 역 기록만',
  (select count(*)::text from public.record_cards
    where station_id = (select id from public.stations where code = 'S-0001')),
  '2');

select test.eq('F-06: (visited_on, id) 키셋 정렬이 뷰에서도 성립한다',
  (select string_agg(right(id::text, 4), ',')
     from (select id from public.record_cards
            order by visited_on desc, id desc limit 2) t),
  '0073,0072');

-- ── 쓰기 차단 ──────────────────────────────────────────────────────────────
-- 단순 투영 뷰는 Postgres 기준 자동 갱신 가능이다. 권한을 걷어내지 않으면 이 뷰가
-- records 로 가는 우회 쓰기 경로가 된다.

select test.raises('record_cards 로는 INSERT 할 수 없다 (조회 전용)',
  $q$insert into public.record_cards (id, station_id, visited_on, author_id)
     values ('00000000-0000-0000-0000-00000000007a',
             (select id from public.stations where code = 'S-0001'),
             current_date, '00000000-0000-0000-0000-0000000000a1')$q$,
  '42501');

select test.raises('record_cards 로는 UPDATE 할 수 없다',
  $q$update public.record_cards set mood = 'sad'
      where id = '00000000-0000-0000-0000-000000000071'$q$,
  '42501');

select test.raises('record_cards 로는 DELETE 할 수 없다',
  $q$delete from public.record_cards
      where id = '00000000-0000-0000-0000-000000000071'$q$,
  '42501');

-- ── 비로그인 ───────────────────────────────────────────────────────────────

reset role;
select test.as_anon();
set role anon;

select test.raises('anon 은 record_cards 를 아예 읽을 수 없다',
  'select count(*) from public.record_cards', '42501');

reset role;
