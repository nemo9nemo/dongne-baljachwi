-- D07: 파일은 Storage API로 삭제한다. SQL에서 storage.objects 행을 지우지 않는다.
create table public.photo_cleanup_jobs (
  path text primary key, claimed_at timestamptz not null default now(),
  completed_at timestamptz, attempts integer not null default 1, last_error text
);
alter table public.photo_cleanup_jobs enable row level security;
revoke all on public.photo_cleanup_jobs from public,anon,authenticated;
grant select,insert,update on public.photo_cleanup_jobs to service_role;

create function public.photo_cleanup_claimed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.photo_cleanup_jobs where path=p_path);
$$;
revoke all on function public.photo_cleanup_claimed(text) from public,anon;
grant execute on function public.photo_cleanup_claimed(text) to authenticated,service_role;

-- 사진 확정과 정리 후보 확정이 같은 경로 잠금을 사용하므로 두 작업이 엇갈리지 않는다.
create function public.guard_photo_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photo:'||new.storage_path,0));
  if public.photo_cleanup_claimed(new.storage_path) then
    perform public.app_raise('INVALID_PHOTOS','photo cleanup is already claimed');
  end if;
  return new;
end;
$$;
create trigger record_photos_guard_cleanup before insert or update of storage_path on public.record_photos
  for each row execute function public.guard_photo_cleanup();

create function public.get_photo_cleanup_candidates(p_limit integer default 100) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) from (
    select o.name as path from storage.objects o
    where o.bucket_id='record-photos' and (
      exists(select 1 from public.couples c where c.id::text=(storage.foldername(o.name))[1]
        and c.status='dissolved' and c.purge_after<=now())
      or (o.created_at<now()-interval '7 days' and not exists(select 1 from public.record_photos p where p.storage_path=o.name))
    ) order by o.created_at,o.name limit greatest(1,least(coalesce(p_limit,100),1000))
  ) candidate;
$$;

create function public.claim_photo_cleanup(p_paths text[]) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_path text; v_result jsonb:='[]'::jsonb;
begin
  if coalesce(cardinality(p_paths),0)>100 then raise exception 'cleanup batch exceeds 100'; end if;
  for v_path in select distinct unnest(p_paths) order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photo:'||v_path,0));
    if exists(select 1 from storage.objects o where o.bucket_id='record-photos' and o.name=v_path and (
      exists(select 1 from public.couples c where c.id::text=(storage.foldername(o.name))[1] and c.status='dissolved' and c.purge_after<=now())
      or (o.created_at<now()-interval '7 days' and not exists(select 1 from public.record_photos p where p.storage_path=o.name))
    )) then
      insert into public.photo_cleanup_jobs(path) values(v_path) on conflict(path)
        do update set attempts=public.photo_cleanup_jobs.attempts+1,last_error=null;
      v_result:=v_result||jsonb_build_array(v_path);
    end if;
  end loop;
  return v_result;
end;
$$;

create function public.complete_photo_cleanup(p_path text,p_success boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  update public.photo_cleanup_jobs set completed_at=case when p_success then now() else null end,
    last_error=case when p_success then null else 'Storage API deletion failed' end where path=p_path;
end;
$$;
create function public.finalize_expired_record_space(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  perform 1 from public.couples where id=p_id and status='dissolved' and purge_after<=now() for update;
  if not found or exists(select 1 from storage.objects where bucket_id='record-photos' and (storage.foldername(name))[1]=p_id::text) then return false; end if;
  delete from public.couples where id=p_id;
  return true;
end;
$$;
revoke all on function public.get_photo_cleanup_candidates(integer),public.claim_photo_cleanup(text[]),
  public.complete_photo_cleanup(text,boolean),public.finalize_expired_record_space(uuid) from public,anon,authenticated;
grant execute on function public.get_photo_cleanup_candidates(integer),public.claim_photo_cleanup(text[]),
  public.complete_photo_cleanup(text,boolean),public.finalize_expired_record_space(uuid) to service_role;

-- 이미 정리 중인 경로를 재업로드해 파일 삭제와 저장이 경합하지 않도록 한다.
do $$
declare p record;
begin
  for p in select * from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('record_photos_insert_own_couple','record_photos_update_own_couple')
  loop
    if p.with_check is not null then execute format('alter policy %I on storage.objects with check ((%s) and not public.photo_cleanup_claimed(name))',p.policyname,p.with_check); end if;
  end loop;
end;
$$;
