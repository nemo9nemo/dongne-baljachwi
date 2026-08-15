-- ============================================================================
-- 60. 기록 저장 RPC — upsert_record()
--
-- 근거: 05-record-editor.md §4.2, F-30/F-31/F-34, AC-02/AC-05/AC-06/AC-07/AC-12/AC-17
--
-- 픽스처
--   커플 A(...00aa): alice(...00a1) + bob(...00a2)
--   커플 B(...00bb): carol(...00b1)                  — 미끼 기록 rb(...0012)
--   dave(...00c1): 커플 없음
--   역 S-0001 / S-0002
--
-- 함수 반환값은 GUC(test.r*)에 담아 다음 문장에서 꺼내 쓴다 (50-station-master 와 같은 방식).
-- ============================================================================

select test.reset();

select test.signup('00000000-0000-0000-0000-0000000000a1', 'alice@example.com');
select test.signup('00000000-0000-0000-0000-0000000000a2', 'bob@example.com');
select test.signup('00000000-0000-0000-0000-0000000000b1', 'carol@example.com');
select test.signup('00000000-0000-0000-0000-0000000000c1', 'dave@example.com');

insert into public.couples (id, started_on, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', current_date - 100, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000bb', current_date - 100, '00000000-0000-0000-0000-0000000000b1');

insert into public.couple_members (couple_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a2', 'partner'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'owner');

select test.seed_station('S-0001', '홍대입구');
select test.seed_station('S-0002', '합정');

insert into public.records (id, couple_id, station_id, visited_on, author_id)
select '00000000-0000-0000-0000-000000000012',
       '00000000-0000-0000-0000-0000000000bb', s.id, current_date - 1,
       '00000000-0000-0000-0000-0000000000b1'
from public.stations s where s.code = 'S-0001';

-- ── 커플 미연결 (05 §4.2) ──────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000c1');
set role authenticated;

select test.raises('커플에 속하지 않은 사용자는 기록을 저장할 수 없다',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date)$q$,
  'P0001', '%NOT_IN_COUPLE%');

-- ── 신규 작성 (alice) ──────────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a1');

select set_config('test.r', public.upsert_record(
  null,
  (select id from public.stations where code = 'S-0001'),
  current_date - 2,
  'happy', 'sunny', '첫 데이트',
  -- 중복(Cafe/cafe)과 정보 없는 입력('#', 공백)을 섞어 넣는다.
  array['  #Cafe  ', 'cafe', '산책', '#', '   ']
)::text, false);

select test.eq('신규 저장: created = true',
  current_setting('test.r')::jsonb ->> 'created', 'true');

select test.eq('신규 저장: updated_at 이 응답에 실린다',
  (current_setting('test.r')::jsonb ->> 'updated_at' is not null)::text, 'true');

select set_config('test.rid', current_setting('test.r')::jsonb ->> 'record_id', false);

select test.eq('신규 저장: 내 커플 기록으로 들어간다',
  (select couple_id::text from public.records where id = current_setting('test.rid')::uuid),
  '00000000-0000-0000-0000-0000000000aa');

select test.eq('신규 저장: author_id 는 호출자',
  (select author_id::text from public.records where id = current_setting('test.rid')::uuid),
  '00000000-0000-0000-0000-0000000000a1');

select test.eq('신규 저장: 본문 필드가 그대로 저장된다',
  (select mood || '/' || weather || '/' || note from public.records
    where id = current_setting('test.rid')::uuid),
  'happy/sunny/첫 데이트');

select test.eq('AC-06: 중복 태그와 빈 태그는 조용히 무시된다 (5개 입력 → 2개 저장)',
  (select count(*)::text from public.record_tags
    where record_id = current_setting('test.rid')::uuid), '2');

select test.eq('AC-05: "  #Cafe  " → tag = Cafe, tag_norm = cafe',
  (select tag || '/' || tag_norm from public.record_tags
    where record_id = current_setting('test.rid')::uuid and tag_norm = 'cafe'),
  'Cafe/cafe');

select test.eq('record_tags.couple_id 는 부모 기록에서 채워진다',
  (select count(distinct couple_id)::text || ':' || max(couple_id::text)
     from public.record_tags where record_id = current_setting('test.rid')::uuid),
  '1:00000000-0000-0000-0000-0000000000aa');

-- ── AC-02: 역 + 날짜만으로도 저장된다 ──────────────────────────────────────

select set_config('test.r2', public.upsert_record(
  null, (select id from public.stations where code = 'S-0002'), current_date
)::text, false);

select test.eq('AC-02: 감정·날씨·일기·태그 없이 저장 성공',
  current_setting('test.r2')::jsonb ->> 'created', 'true');

select test.eq('AC-02: 선택 항목은 NULL 로 남는다',
  (select coalesce(mood, '-') || coalesce(weather, '-') || coalesce(note, '-')
     from public.records where id = (current_setting('test.r2')::jsonb ->> 'record_id')::uuid),
  '---');

-- 공백만 있는 일기는 "일기 없음"과 같아야 한다.
select set_config('test.r3', public.upsert_record(
  (current_setting('test.r2')::jsonb ->> 'record_id')::uuid,
  (select id from public.stations where code = 'S-0002'), current_date, null, null, '   '
)::text, false);

select test.eq('공백뿐인 일기는 NULL 로 저장된다',
  (select coalesce(note, 'NULL') from public.records
    where id = (current_setting('test.r2')::jsonb ->> 'record_id')::uuid), 'NULL');

-- D-13: 서버(UTC) 기준 +1일까지 허용한다. KST 새벽에 사용자의 "오늘"이 서버의 내일이기 때문.
select test.eq('D-13: current_date + 1 은 거부되지 않는다 (KST 새벽 보정)',
  public.upsert_record(
    null, (select id from public.stations where code = 'S-0001'), current_date + 1
  ) ->> 'created', 'true');

-- ── 입력 검증 (05 §4.2 표) ─────────────────────────────────────────────────

select test.raises('존재하지 않는 역',
  $q$select public.upsert_record(
       null, '00000000-0000-0000-0000-0000000000ff', current_date)$q$,
  'P0001', '%STATION_NOT_FOUND%');

select test.raises('미래 날짜는 거부된다',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date + 5)$q$,
  'P0001', '%INVALID_DATE%');

select test.raises('날짜 누락',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), null)$q$,
  'P0001', '%INVALID_DATE%');

select test.raises('F-14: 허용 목록에 없는 mood',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date, 'angry')$q$,
  'P0001', '%INVALID_ENUM%');

select test.raises('F-14: 허용 목록에 없는 weather',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date, null, 'foggy')$q$,
  'P0001', '%INVALID_ENUM%');

select test.raises('F-24: 일기 2,001자',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date,
       null, null, repeat('가', 2001))$q$,
  'P0001', '%NOTE_TOO_LONG%');

select test.raises('AC-07: 태그 11개',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date,
       null, null, null,
       array['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11'])$q$,
  'P0001', '%INVALID_TAGS%');

select test.raises('00 §4.7-5: 21자 태그',
  $q$select public.upsert_record(
       null, (select id from public.stations where code = 'S-0001'), current_date,
       null, null, null, array[repeat('가', 21)])$q$,
  'P0001', '%INVALID_TAGS%');

-- AC-17: 커플 B 의 기록 id 를 넘겨도 "없는 기록"과 같은 응답이어야 한다.
select test.raises('AC-17: 다른 커플의 record_id → RECORD_NOT_FOUND',
  $q$select public.upsert_record(
       '00000000-0000-0000-0000-000000000012',
       (select id from public.stations where code = 'S-0001'), current_date)$q$,
  'P0001', '%RECORD_NOT_FOUND%');

select test.raises('존재하지 않는 record_id → 같은 코드 (두 경우를 구분하지 않는다)',
  $q$select public.upsert_record(
       '00000000-0000-0000-0000-0000000000ee',
       (select id from public.stations where code = 'S-0001'), current_date)$q$,
  'P0001', '%RECORD_NOT_FOUND%');

-- SECURITY DEFINER 함수는 RLS 를 우회한다 — 커플 격리를 함수의 WHERE 절이 전부 책임진다는 뜻이다.
-- 그래서 "안 보인다"가 아니라 "실제로 안 바뀌었다"를 RLS 밖(reset role)에서 확인한다.
reset role;
select test.eq('AC-17: 실패한 호출이 커플 B 기록을 실제로 바꾸지 않았다',
  (select s.code || '/' || r.visited_on::text from public.records r
     join public.stations s on s.id = r.station_id
    where r.id = '00000000-0000-0000-0000-000000000012'),
  'S-0001/' || (current_date - 1)::text);
set role authenticated;

-- ── 수정 (bob 이 alice 의 기록을 고친다) ───────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a2');

select set_config('test.u', public.upsert_record(
  current_setting('test.rid')::uuid,
  (select id from public.stations where code = 'S-0002'),
  current_date - 1,
  null,        -- F-13: 감정 해제
  'rainy',
  null,
  array['산책', '포장마차']
)::text, false);

select test.eq('F-32: 상대가 쓴 기록도 수정할 수 있다 (created = false)',
  current_setting('test.u')::jsonb ->> 'created', 'false');

select test.eq('AC-12: author_id 는 최초 작성자 그대로',
  (select author_id::text from public.records where id = current_setting('test.rid')::uuid),
  '00000000-0000-0000-0000-0000000000a1');

select test.eq('AC-12/F-31: last_edited_by 는 수정자로 갱신된다',
  (select last_edited_by::text from public.records where id = current_setting('test.rid')::uuid),
  '00000000-0000-0000-0000-0000000000a2');

select test.eq('F-06: 역 변경이 반영된다',
  (select s.code from public.records r join public.stations s on s.id = r.station_id
    where r.id = current_setting('test.rid')::uuid), 'S-0002');

select test.eq('F-13: 감정 해제(null)와 일기 삭제가 반영된다',
  (select coalesce(mood, '-') || coalesce(note, '-') from public.records
    where id = current_setting('test.rid')::uuid), '--');

select test.eq('응답의 updated_at 은 실제 행의 값과 같다',
  (select (updated_at = (current_setting('test.u')::jsonb ->> 'updated_at')::timestamptz)::text
     from public.records where id = current_setting('test.rid')::uuid), 'true');

select test.eq('태그는 전 행 삭제 후 재삽입된다 (2개 유지)',
  (select count(*)::text from public.record_tags
    where record_id = current_setting('test.rid')::uuid), '2');

select test.eq('이전 태그(cafe)는 남지 않는다',
  (select count(*)::text from public.record_tags
    where record_id = current_setting('test.rid')::uuid and tag_norm = 'cafe'), '0');

select test.eq('새 태그가 정확히 저장된다',
  (select string_agg(tag_norm, ',' order by tag_norm) from public.record_tags
    where record_id = current_setting('test.rid')::uuid), '산책,포장마차');

-- ── F-34: 본문 + 태그는 한 트랜잭션 ───────────────────────────────────────

select test.raises('F-34: 태그 검증에서 실패하면 본문 변경도 남지 않는다',
  $q$select public.upsert_record(
       current_setting('test.rid')::uuid,
       (select id from public.stations where code = 'S-0001'),
       current_date, null, null, '롤백되어야 하는 일기',
       array['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11'])$q$,
  'P0001', '%INVALID_TAGS%');

select test.eq('F-34: 실패한 저장의 일기가 반영되지 않았다',
  (select coalesce(note, 'NULL') from public.records
    where id = current_setting('test.rid')::uuid), 'NULL');

select test.eq('F-34: 실패한 저장의 태그 교체도 일어나지 않았다',
  (select string_agg(tag_norm, ',' order by tag_norm) from public.record_tags
    where record_id = current_setting('test.rid')::uuid), '산책,포장마차');

-- ── 태그 10개 경계 ─────────────────────────────────────────────────────────

select test.eq('태그 정확히 10개는 통과한다',
  (public.upsert_record(
     current_setting('test.rid')::uuid,
     (select id from public.stations where code = 'S-0001'),
     current_date, null, null, null,
     array['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10']
   ) ->> 'created'), 'false');

select test.eq('태그 10개가 모두 저장된다',
  (select count(*)::text from public.record_tags
    where record_id = current_setting('test.rid')::uuid), '10');

reset role;
