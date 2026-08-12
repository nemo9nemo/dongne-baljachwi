-- ============================================================================
-- 30. 기록 — records / record_photos / record_tags / 집계 뷰 / Storage
--
-- 근거: 00-data-model.md §4.5~§4.9, AC-01/AC-02/AC-03/AC-07/AC-08/AC-09/AC-10
--
-- 픽스처
--   커플 A(...00aa): alice(...00a1) + bob(...00a2)   — 기록 r1(...0011)
--   커플 B(...00bb): carol(...00b1)                  — 기록 rb(...0012)
--   역 S-0001 / S-0002
-- ============================================================================

select test.reset();

select test.signup('00000000-0000-0000-0000-0000000000a1', 'alice@example.com');
select test.signup('00000000-0000-0000-0000-0000000000a2', 'bob@example.com');
select test.signup('00000000-0000-0000-0000-0000000000b1', 'carol@example.com');

insert into public.couples (id, started_on, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', current_date - 100, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000bb', current_date - 100, '00000000-0000-0000-0000-0000000000b1');

insert into public.couple_members (couple_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a2', 'partner'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'owner');

select test.seed_station('S-0001', '홍대입구');
select test.seed_station('S-0002', '합정');

-- 커플 B 의 기록 (격리 검증용 미끼).
insert into public.records (id, couple_id, station_id, visited_on, author_id)
select '00000000-0000-0000-0000-000000000012',
       '00000000-0000-0000-0000-0000000000bb', s.id, current_date - 1,
       '00000000-0000-0000-0000-0000000000b1'
from public.stations s where s.code = 'S-0001';

-- ── alice 로 로그인 ────────────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

with ins as (
  insert into public.records (id, couple_id, station_id, visited_on, mood, weather, note, author_id)
  select '00000000-0000-0000-0000-000000000011',
         public.current_couple_id(), s.id, current_date - 2, 'happy', 'sunny', '첫 데이트',
         '00000000-0000-0000-0000-0000000000a1'
  from public.stations s where s.code = 'S-0001'
  returning 1
)
select test.eq('records: 내 커플 기록 INSERT 성공', (select count(*) from ins)::text, '1');

select test.eq('AC-01: 필터 없이 조회해도 다른 커플 기록은 0행',
  (select count(*)::text from public.records), '1');

select test.raises('AC-02: 다른 커플의 couple_id 로 INSERT 하면 RLS 위반',
  $q$insert into public.records (couple_id, station_id, visited_on, author_id)
     select '00000000-0000-0000-0000-0000000000bb', s.id, current_date,
            '00000000-0000-0000-0000-0000000000a1'
     from public.stations s where s.code = 'S-0001'$q$,
  '42501');

select test.raises('records: 남의 이름(author_id)으로 기록을 만들 수 없다',
  $q$insert into public.records (couple_id, station_id, visited_on, author_id)
     select public.current_couple_id(), s.id, current_date,
            '00000000-0000-0000-0000-0000000000a2'
     from public.stations s where s.code = 'S-0001'$q$,
  '42501');

select test.raises('D-09: mood 는 CHECK 로 제한된다',
  $q$update public.records set mood = 'angry'
      where id = '00000000-0000-0000-0000-000000000011'$q$,
  '23514');

select test.raises('note 는 2,000자를 넘을 수 없다',
  $q$update public.records set note = repeat('가', 2001)
      where id = '00000000-0000-0000-0000-000000000011'$q$,
  '23514');

-- ── 태그 (00 §4.7) ─────────────────────────────────────────────────────────

insert into public.record_tags (record_id, tag_norm, couple_id, tag)
values ('00000000-0000-0000-0000-000000000011', 'IGNORED',
        '00000000-0000-0000-0000-0000000000bb', '  #Cafe  ');

select test.eq('AC-09: " #Cafe " → tag = Cafe',
  (select tag from public.record_tags
    where record_id = '00000000-0000-0000-0000-000000000011'), 'Cafe');

select test.eq('AC-09: tag_norm 은 소문자 (Cafe 와 cafe 를 같은 필터로 묶는다)',
  (select tag_norm from public.record_tags
    where record_id = '00000000-0000-0000-0000-000000000011'), 'cafe');

select test.eq('record_tags.couple_id 는 클라이언트 값이 아니라 부모 records 에서 복사된다',
  (select couple_id::text from public.record_tags
    where record_id = '00000000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-0000000000aa');

select test.raises('record_tags: 다른 커플의 기록에는 태그를 달 수 없다 (트리거가 소유권 검증)',
  $q$insert into public.record_tags (record_id, tag_norm, couple_id, tag)
     values ('00000000-0000-0000-0000-000000000012', 'x',
             '00000000-0000-0000-0000-0000000000aa', 'spy')$q$,
  '42501');

do $$
begin
  -- 이미 1개 있으므로 9개를 더 넣으면 정확히 10개(상한)가 된다.
  for _i in 2..10 loop
    insert into public.record_tags (record_id, tag_norm, couple_id, tag)
    values ('00000000-0000-0000-0000-000000000011', 'x',
            '00000000-0000-0000-0000-0000000000aa', 'tag' || _i);
  end loop;
end;
$$;

select test.raises('00 §4.7-6: 기록당 태그는 10개까지',
  $q$insert into public.record_tags (record_id, tag_norm, couple_id, tag)
     values ('00000000-0000-0000-0000-000000000011', 'y',
             '00000000-0000-0000-0000-0000000000aa', 'overflow')$q$,
  '23514');

select test.raises('record_tags: UPDATE 권한 없음 (수정은 삭제 후 재삽입)',
  $q$update public.record_tags set tag = 'z'
      where record_id = '00000000-0000-0000-0000-000000000011'$q$,
  '42501');

-- ── 사진 (00 §4.6) ─────────────────────────────────────────────────────────

do $$
begin
  for _i in 0..4 loop
    insert into public.record_photos
      (record_id, couple_id, storage_path, sort_order, width, height, byte_size, content_type)
    values ('00000000-0000-0000-0000-000000000011',
            '00000000-0000-0000-0000-0000000000aa',
            '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-000000000011/p'
              || _i || '.jpg',
            _i, 1200, 800, 100000, 'image/jpeg');
  end loop;
end;
$$;

select test.eq('사진 5장까지 정상 등록', (select count(*)::text from public.record_photos), '5');

select test.raises('AC-10: 6번째 사진은 sort_order 범위(0..4)에 걸려 거부된다',
  $q$insert into public.record_photos
       (record_id, couple_id, storage_path, sort_order, width, height, byte_size, content_type)
     values ('00000000-0000-0000-0000-000000000011',
             '00000000-0000-0000-0000-0000000000aa', 'aa/11/p5.jpg', 5,
             1200, 800, 100000, 'image/jpeg')$q$,
  '23514');

select test.raises('사진 순서 중복은 UNIQUE(record_id, sort_order) 로 막힌다 (동시 업로드 경합)',
  $q$insert into public.record_photos
       (record_id, couple_id, storage_path, sort_order, width, height, byte_size, content_type)
     values ('00000000-0000-0000-0000-000000000011',
             '00000000-0000-0000-0000-0000000000aa', 'aa/11/dup.jpg', 0,
             1200, 800, 100000, 'image/jpeg')$q$,
  '23505');

select test.raises('content_type 은 jpeg/png/webp 만',
  $q$insert into public.record_photos
       (record_id, couple_id, storage_path, sort_order, width, height, byte_size, content_type)
     values ('00000000-0000-0000-0000-000000000011',
             '00000000-0000-0000-0000-0000000000aa', 'aa/11/x.gif', 3,
             1200, 800, 100000, 'image/gif')$q$,
  '23514');

-- ── Storage 격리 (AC-03) ───────────────────────────────────────────────────

with ins as (
  insert into storage.objects (bucket_id, name)
  values ('record-photos',
          '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-000000000011/p0.jpg')
  returning 1
)
select test.eq('Storage: 내 커플 폴더에는 업로드할 수 있다',
  (select count(*) from ins)::text, '1');

select test.raises('AC-03: 다른 커플 폴더에는 업로드할 수 없다',
  $q$insert into storage.objects (bucket_id, name)
     values ('record-photos', '00000000-0000-0000-0000-0000000000bb/x/y.jpg')$q$,
  '42501');

select test.raises('AC-03: 남의 폴더로 이동(UPDATE)도 막힌다',
  $q$update storage.objects
        set name = '00000000-0000-0000-0000-0000000000bb/x/y.jpg'
      where bucket_id = 'record-photos'$q$,
  '42501');

-- ── 커플 내부 공동 권한 + 작성자 보존 (00 §4.5) ────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a2');

with u as (
  update public.records set note = '밥이 고쳐 씀'
   where id = '00000000-0000-0000-0000-000000000011'
  returning 1
)
select test.eq('상대가 쓴 기록도 수정할 수 있다 (커플 공동 아카이브)',
  (select count(*) from u)::text, '1');

select test.eq('author_id 는 최초 작성자로 고정된다',
  (select author_id::text from public.records
    where id = '00000000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-0000000000a1');

select test.eq('last_edited_by 는 마지막 수정자로 갱신된다',
  (select last_edited_by::text from public.records
    where id = '00000000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-0000000000a2');

-- author_id 를 직접 바꿔도 트리거가 되돌린다.
update public.records set author_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-000000000011';
select test.eq('author_id 를 직접 UPDATE 해도 이전 값이 유지된다',
  (select author_id::text from public.records
    where id = '00000000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-0000000000a1');

-- couple_id 를 바꿔 다른 커플로 기록을 옮기는 경로도 트리거가 막는다.
update public.records set couple_id = '00000000-0000-0000-0000-0000000000bb'
 where id = '00000000-0000-0000-0000-000000000011';
select test.eq('couple_id 를 직접 UPDATE 해도 기록이 다른 커플로 옮겨지지 않는다',
  (select couple_id::text from public.records
    where id = '00000000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-0000000000aa');

-- ── 집계 뷰 (D-12) ─────────────────────────────────────────────────────────

select test.eq('AC-08: couple_station_visits 는 내 커플 행만 (security_invoker)',
  (select count(*)::text from public.couple_station_visits), '1');

select test.eq('couple_station_visits.visit_count',
  (select visit_count::text from public.couple_station_visits), '1');

select test.eq('couple_tag_usage 도 내 커플 행만',
  (select count(*)::text from public.couple_tag_usage
    where couple_id <> '00000000-0000-0000-0000-0000000000aa'), '0');

-- ── 마스터 데이터 (D-11) ───────────────────────────────────────────────────

select test.eq('D-11: 로그인 사용자는 역 마스터를 읽을 수 있다',
  (select count(*)::text from public.stations), '2');

select test.raises('D-11: 클라이언트는 역 마스터를 쓸 수 없다 (배치 전용)',
  $q$update public.stations set name = '가짜역' where code = 'S-0001'$q$,
  '42501');

select test.eq('F-09: master_version 은 읽을 수 있다 (캐시 무효화 신호)',
  (select value ->> 'version' from public.app_settings where key = 'master_version'), '0');

select test.raises('운영 테이블(station_source_raw)은 클라이언트에 보이지 않는다',
  'select count(*) from public.station_source_raw', '42501');

-- ── FK RESTRICT (AC-07) ────────────────────────────────────────────────────

reset role;
-- 에러 코드가 23503(foreign_key_violation)이 아니라 23001(restrict_violation)이다.
-- ON DELETE RESTRICT 는 즉시 검사라 별도 코드가 나간다 — 배치가 이 코드로 분기한다면
-- 23503 만 보고 있으면 못 잡는다.
select test.raises('AC-07: 기록이 참조 중인 역은 삭제할 수 없다 (폐역은 is_active=false)',
  $q$delete from public.stations where code = 'S-0001'$q$,
  '23001');

-- ── 삭제 CASCADE ───────────────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

delete from public.records where id = '00000000-0000-0000-0000-000000000011';

select test.eq('기록 삭제 시 사진 메타데이터도 함께 사라진다 (CASCADE)',
  (select count(*)::text from public.record_photos), '0');
select test.eq('기록 삭제 시 태그도 함께 사라진다 (CASCADE)',
  (select count(*)::text from public.record_tags), '0');

reset role;

-- Storage 객체는 DB CASCADE 대상이 아니다. 삭제 실패 시 고아 파일이 남는 것을 알고 있고,
-- 배치가 주기적으로 정리한다 (00 §4.6 "고아 파일"). 여기서는 그 사실만 못 박아 둔다.
select test.eq('알려진 한계: Storage 객체는 DB 삭제로 지워지지 않는다 (배치가 정리)',
  (select count(*)::text from storage.objects), '1');
