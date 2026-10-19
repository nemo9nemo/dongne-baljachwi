-- D01–D04: 완전한 편집 스냅샷, 버전 검사, 원자적 사진 목록, 재시도 영수증.
-- 운영 전환 시 이 마이그레이션과 새 클라이언트를 함께 적용한다. 구버전 쓰기는 거부한다.
alter table public.records add column revision integer not null default 1 check (revision > 0);

create function public.records_increment_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger records_increment_revision before update on public.records
for each row execute function public.records_increment_revision();

-- 기록 삭제 뒤에도 생성 ID는 재사용하지 않는다. 영수증 정리와 독립적인 작은 묘비다.
create table public.record_creation_ids (
  record_id uuid primary key,
  couple_id uuid not null references public.couples(id) on delete cascade
);
insert into public.record_creation_ids select id, couple_id from public.records;
create table public.record_write_receipts (
  actor_id uuid not null,
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null check (kind in ('body', 'photos')),
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, couple_id, kind, operation_id)
);
alter table public.record_creation_ids enable row level security;
alter table public.record_write_receipts enable row level security;
revoke all on public.record_creation_ids, public.record_write_receipts from public, anon, authenticated;

-- D01: 한 SQL 문장의 스냅샷에서 읽으며 호출자 RLS를 그대로 적용한다.
create function public.get_record_edit_snapshot(p_record_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'record', to_jsonb(r),
    'tags', coalesce((select jsonb_agg(t.tag order by t.tag_norm)
                     from public.record_tags t where t.record_id = r.id), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                       from public.record_photos p where p.record_id = r.id), '[]'::jsonb)
  ) from public.records r where r.id = p_record_id;
$$;
revoke all on function public.get_record_edit_snapshot(uuid) from public, anon;
grant execute on function public.get_record_edit_snapshot(uuid) to authenticated;

create function public.save_record_v2(
  p_record_id uuid, p_operation_id uuid, p_create boolean, p_expected_revision integer,
  p_station_id uuid, p_visited_on date, p_mood text, p_weather text, p_note text, p_tags text[]
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope uuid := (select public.current_couple_id());
  v_request jsonb := jsonb_build_array(p_record_id, p_create, p_expected_revision,
    p_station_id, p_visited_on, p_mood, p_weather, p_note, p_tags);
  v_receipt public.record_write_receipts;
  v_row public.records;
  v_result jsonb;
  v_tags text[];
begin
  if v_uid is null then perform public.app_raise('UNAUTHENTICATED', 'authentication required'); end if;
  if v_scope is null then perform public.app_raise('NOT_IN_COUPLE', 'active scope required'); end if;
  if p_record_id is null or p_operation_id is null or p_create is null then
    perform public.app_raise('INVALID_OPERATION', 'missing operation identity');
  end if;
  -- 같은 작업을 직렬화하며 성공한 재시도는 버전 검사보다 먼저 영수증으로 확인한다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_uid::text || v_scope::text || 'body' || p_operation_id::text, 0));
  select * into v_receipt from public.record_write_receipts
    where actor_id = v_uid and couple_id = v_scope and kind = 'body' and operation_id = p_operation_id;
  if found then
    if v_receipt.request <> v_request then perform public.app_raise('OPERATION_MISMATCH', 'request changed'); end if;
    if not exists (select 1 from public.records where id = p_record_id and couple_id = v_scope) then
      perform public.app_raise('RECORD_NOT_FOUND', 'record not found');
    end if;
    return v_receipt.result;
  end if;
  if p_create then
    if p_expected_revision is not null then perform public.app_raise('INVALID_OPERATION', 'create has no revision'); end if;
    insert into public.record_creation_ids values (p_record_id, v_scope) on conflict do nothing;
    if not found then perform public.app_raise('RECORD_ID_USED', 'creation id already used'); end if;
  else
    select * into v_row from public.records where id = p_record_id and couple_id = v_scope for update;
    if not found then perform public.app_raise('RECORD_NOT_FOUND', 'record not found'); end if;
    if p_expected_revision is distinct from v_row.revision then
      perform public.app_raise('RECORD_CONFLICT', 'revision changed');
    end if;
  end if;
  if p_station_id is null or not exists (select 1 from public.stations where id = p_station_id) then
    perform public.app_raise('STATION_NOT_FOUND', 'station not found');
  end if;
  if p_visited_on is null or p_visited_on > current_date + 1 then perform public.app_raise('INVALID_DATE', 'invalid date'); end if;
  if nullif(p_mood, '') is not null and p_mood not in ('happy','love','excited','calm','sad')
     or nullif(p_weather, '') is not null and p_weather not in ('sunny','cloudy','rainy','snowy','windy') then
    perform public.app_raise('INVALID_ENUM', 'invalid enum');
  end if;
  if char_length(p_note) > 1000 then perform public.app_raise('NOTE_TOO_LONG', 'note exceeds 1000 characters'); end if;
  if coalesce(cardinality(p_tags), 0) > 10 or exists (
    select 1 from unnest(p_tags) t where char_length(public.normalize_tag(t)) > 20
  ) then perform public.app_raise('INVALID_TAGS', 'invalid tags'); end if;
  select array_agg(tag order by ord) into v_tags from (
    select distinct on (lower(public.normalize_tag(t))) public.normalize_tag(t) tag, ord
    from unnest(p_tags) with ordinality x(t, ord)
    where public.normalize_tag(t) <> '' order by lower(public.normalize_tag(t)), ord
  ) normalized;
  if p_create then
    insert into public.records (id, couple_id, station_id, visited_on, mood, weather, note, author_id)
    values (p_record_id, v_scope, p_station_id, p_visited_on, nullif(p_mood,''), nullif(p_weather,''),
      case when btrim(coalesce(p_note,'')) = '' then null else p_note end, v_uid) returning * into v_row;
  else
    update public.records set station_id = p_station_id, visited_on = p_visited_on,
      mood = nullif(p_mood,''), weather = nullif(p_weather,''),
      note = case when btrim(coalesce(p_note,'')) = '' then null else p_note end
      where id = p_record_id and couple_id = v_scope returning * into v_row;
  end if;
  delete from public.record_tags where record_id = p_record_id;
  insert into public.record_tags(record_id, couple_id, tag, tag_norm)
    select p_record_id, v_scope, t, lower(t) from unnest(v_tags) t;
  v_result := jsonb_build_object('record_id', v_row.id, 'created', p_create,
    'revision', v_row.revision, 'updated_at', v_row.updated_at);
  insert into public.record_write_receipts values (v_uid, v_scope, 'body', p_operation_id, v_request, v_result, now());
  return v_result;
end;
$$;

create function public.sync_record_photos(
  p_record_id uuid, p_operation_id uuid, p_expected_revision integer, p_photos jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope uuid := (select public.current_couple_id());
  v_request jsonb := jsonb_build_array(p_record_id, p_expected_revision, p_photos);
  v_receipt public.record_write_receipts;
  v_row public.records;
  v_photo record;
  v_removed jsonb;
  v_result jsonb;
begin
  if v_uid is null then perform public.app_raise('UNAUTHENTICATED', 'authentication required'); end if;
  if v_scope is null then perform public.app_raise('NOT_IN_COUPLE', 'active scope required'); end if;
  if p_record_id is null or p_operation_id is null then perform public.app_raise('INVALID_OPERATION', 'missing operation identity'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_uid::text || v_scope::text || 'photos' || p_operation_id::text, 0));
  -- 영수증도 현재 행 귀속을 확인한 뒤에만 돌려준다.
  select * into v_row from public.records where id = p_record_id and couple_id = v_scope for update;
  if not found then perform public.app_raise('RECORD_NOT_FOUND', 'record not found'); end if;
  select * into v_receipt from public.record_write_receipts
    where actor_id = v_uid and couple_id = v_scope and kind = 'photos' and operation_id = p_operation_id;
  if found then
    if v_receipt.request <> v_request then perform public.app_raise('OPERATION_MISMATCH', 'request changed'); end if;
    return v_receipt.result;
  end if;
  if p_expected_revision is distinct from v_row.revision then perform public.app_raise('RECORD_CONFLICT', 'revision changed'); end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then perform public.app_raise('INVALID_PHOTOS', 'expected photo array'); end if;
  if jsonb_array_length(p_photos) > 10 then perform public.app_raise('INVALID_PHOTOS', 'too many photos'); end if;
  begin
    if (select count(distinct p->>'id') from jsonb_array_elements(p_photos) p) <> jsonb_array_length(p_photos) then
      perform public.app_raise('INVALID_PHOTOS', 'duplicate ids');
    end if;
    for v_photo in select p.* from jsonb_to_recordset(p_photos)
      as p(id uuid, storage_path text, sort_order integer, width integer, height integer, byte_size integer, content_type text)
    loop
      if v_photo.id is null or v_photo.storage_path is null or v_photo.sort_order is null
        or v_photo.width is null or v_photo.height is null or v_photo.byte_size is null or v_photo.content_type is null
        or v_photo.width not between 1 and 2048 or v_photo.height not between 1 and 2048
        or v_photo.byte_size not between 1 and 10485760
        or v_photo.content_type not in ('image/jpeg','image/png','image/webp')
        or v_photo.storage_path !~ ('^' || v_scope::text || '/' || p_record_id::text || '/' || v_photo.id::text || '\.(jpg|jpeg|png|webp)$') then
        perform public.app_raise('INVALID_PHOTOS', 'invalid photo metadata');
      end if;
      if exists (select 1 from public.record_photos where id = v_photo.id
                 and (record_id <> p_record_id or storage_path <> v_photo.storage_path)) then
        perform public.app_raise('INVALID_PHOTOS', 'photo belongs to another record');
      end if;
      if not exists (select 1 from storage.objects where bucket_id = 'record-photos' and name = v_photo.storage_path) then
        perform public.app_raise('INVALID_PHOTOS', 'upload missing');
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(p_photos) with ordinality x(p, ord)
               where (p->>'sort_order')::integer is distinct from ord - 1) then
      perform public.app_raise('INVALID_PHOTOS', 'order must match array');
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    perform public.app_raise('INVALID_PHOTOS', 'invalid photo metadata');
  end;
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_removed from public.record_photos
    where record_id = p_record_id and id not in (select (p->>'id')::uuid from jsonb_array_elements(p_photos) p);
  -- 실패 시 DELETE까지 같은 트랜잭션에서 롤백된다. Storage 정리는 성공 확인 후 클라이언트가 한다.
  delete from public.record_photos where record_id = p_record_id;
  insert into public.record_photos(id, record_id, couple_id, storage_path, sort_order, width, height, byte_size, content_type)
    select p.id, p_record_id, v_scope, p.storage_path, p.sort_order, p.width, p.height, p.byte_size, p.content_type
    from jsonb_to_recordset(p_photos) as p(id uuid, storage_path text, sort_order integer, width integer,
      height integer, byte_size integer, content_type text);
  update public.records set last_edited_by = v_uid where id = p_record_id returning * into v_row;
  v_result := jsonb_build_object('record_id', p_record_id, 'revision', v_row.revision,
    'updated_at', v_row.updated_at, 'removed_paths', v_removed, 'photos', p_photos);
  insert into public.record_write_receipts values (v_uid, v_scope, 'photos', p_operation_id, v_request, v_result, now());
  return v_result;
end;
$$;

revoke all on function public.save_record_v2(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[]),
  public.sync_record_photos(uuid,uuid,integer,jsonb) from public, anon;
grant execute on function public.save_record_v2(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[]),
  public.sync_record_photos(uuid,uuid,integer,jsonb) to authenticated;
revoke execute on function public.upsert_record(uuid,uuid,date,text,text,text,text[]) from authenticated;
revoke insert, update on public.records from authenticated;
revoke insert, update, delete on public.record_photos, public.record_tags from authenticated;

-- 참조 중인 원본 파일을 직접 덮거나 지우는 우회를 차단한다.
drop policy "record_photos_update_own_couple" on storage.objects;
create policy "record_photos_update_own_couple" on storage.objects for update to authenticated
using (bucket_id = 'record-photos' and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  and not exists (select 1 from public.record_photos p where p.storage_path = name))
with check (bucket_id = 'record-photos' and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  and not exists (select 1 from public.record_photos p where p.storage_path = name));
drop policy "record_photos_delete_own_couple" on storage.objects;
create policy "record_photos_delete_own_couple" on storage.objects for delete to authenticated
using (bucket_id = 'record-photos' and (storage.foldername(name))[1] = (select public.current_couple_id())::text
  and not exists (select 1 from public.record_photos p where p.storage_path = name));
