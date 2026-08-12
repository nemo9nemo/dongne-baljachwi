-- ============================================================================
-- Storage: record-photos 버킷 (00 §4.6 Storage 계약, D-10)
--
-- ⚠ Storage 는 읽기 정책과 쓰기 정책이 별개다. 읽기만 걸고 쓰기를 잊으면 다른 커플
-- 폴더에 파일을 올릴 수 있다 (ADR-002 "알려진 함정"). SELECT/INSERT/UPDATE/DELETE 를
-- 모두 명시한다.
--
-- 이 파일만 storage 스키마를 건드린다. 소유 롤 차이로 적용이 막힐 수 있어 코어 스키마와
-- 분리해 두었다 — 실패해도 앞선 마이그레이션은 이미 커밋된 상태로 남는다.
-- ============================================================================

-- 공개 버킷은 URL만 알면 누구나 열 수 있어 커플 격리가 깨진다 → 반드시 비공개 (D-10).
-- 표시용 URL 은 클라이언트가 서명 URL(1시간)로 발급한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'record-photos',
  'record-photos',
  false,
  10485760,   -- 10MB. record_photos.byte_size 상한과 함께 업로드 남용을 막는다.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- 경로 규칙: {couple_id}/{record_id}/{photo_id}.{ext} — 1번째 세그먼트가 격리 축이다.
-- uuid 로 캐스팅하지 않고 text 로 비교하는 이유: 경로가 규칙을 벗어난 객체(수동 업로드 등)가
-- 하나라도 있으면 캐스팅 실패로 정책 평가 자체가 에러가 나 전체 조회가 깨진다.
-- text 비교는 그런 객체를 조용히 "내 것 아님"으로 처리한다.
create policy "record_photos_select_own_couple" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'record-photos'
    and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  );

create policy "record_photos_insert_own_couple" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'record-photos'
    and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  );

-- 덮어쓰기(upsert)도 쓰기다. using/with check 를 모두 걸어야 "남의 폴더로 이동"이 막힌다.
create policy "record_photos_update_own_couple" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'record-photos'
    and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  )
  with check (
    bucket_id = 'record-photos'
    and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  );

create policy "record_photos_delete_own_couple" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'record-photos'
    and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  );
