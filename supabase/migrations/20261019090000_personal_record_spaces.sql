-- D05–D06: 기존 공동 기록은 이동하지 않는다. 개인 공간은 별도 격리 컨테이너다.
-- couples라는 물리 FK는 보존하되 개인 공간에는 couple_members/초대를 만들지 않는다.
create table public.personal_record_spaces (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  space_id uuid not null unique references public.couples(id) on delete cascade
);
alter table public.personal_record_spaces enable row level security;
revoke all on public.personal_record_spaces from public, anon, authenticated;

create function public.current_record_scope() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_requested text := nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-record-scope', '');
  v_id uuid;
begin
  if v_uid is null then return null; end if;
  if v_requested is not null then
    begin v_id := v_requested::uuid; exception when invalid_text_representation then return null; end;
    if exists(select 1 from public.personal_record_spaces where user_id=v_uid and space_id=v_id)
      or v_id = public.current_couple_id() then return v_id; end if;
    return null;
  end if;
  -- 신규 클라이언트는 항상 범위를 보낸다. 미지정 레거시 요청의 기존 공동 범위는 보존한다.
  return public.current_couple_id();
end;
$$;
revoke all on function public.current_record_scope() from public, anon;
grant execute on function public.current_record_scope() to authenticated;

create function public.get_record_context() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_personal uuid;
  v_shared uuid;
begin
  if v_uid is null then perform public.app_raise('UNAUTHENTICATED','authentication required'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal:'||v_uid::text,0));
  select space_id into v_personal from public.personal_record_spaces where user_id=v_uid;
  if v_personal is null then
    insert into public.couples(started_on,created_by)
      values ((now() at time zone 'Asia/Seoul')::date,v_uid) returning id into v_personal;
    insert into public.personal_record_spaces values (v_uid,v_personal);
  end if;
  v_shared := public.current_couple_id();
  return jsonb_build_object('personal_id',v_personal,'shared_id',v_shared);
end;
$$;
revoke all on function public.get_record_context() from public, anon;
grant execute on function public.get_record_context() to authenticated;

-- 기록 관련 함수만 새 범위로 바꾼다. 초대/커플 해제 함수의 멤버십 의미는 유지한다.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.save_record_v2(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[])',
    'public.sync_record_photos(uuid,uuid,integer,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    execute replace(definition,'current_couple_id()','current_record_scope()');
  end loop;
end;
$$;

-- 기존 CRUD 정책의 역할/명령은 유지하고 기록/사진의 범위 판정만 교체한다.
do $$
declare p record; q text; c text; statement text;
begin
  for p in select * from pg_policies where
    (schemaname='public' and tablename in ('records','record_photos','record_tags'))
    or (schemaname='storage' and tablename='objects' and policyname like 'record_photos_%')
  loop
    q := replace(p.qual,'current_couple_id()','current_record_scope()');
    c := replace(p.with_check,'current_couple_id()','current_record_scope()');
    statement := format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
    if q is not null then statement := statement || ' using (' || q || ')'; end if;
    if c is not null then statement := statement || ' with check (' || c || ')'; end if;
    execute statement;
  end loop;
end;
$$;

-- D15: 방문일은 클라이언트와 같은 한국 날짜를 기준으로 검사한다.
alter table public.records drop constraint records_visited_on_not_future;
alter table public.records add constraint records_visited_on_not_future
  check (visited_on <= (now() at time zone 'Asia/Seoul')::date) not valid;
-- 기존 미래값은 임의 수정하지 않는다. 새 쓰기부터 제약을 적용한다.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.save_record_v2(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[])'::regprocedure);
  execute replace(definition,'current_date + 1',$kst$(now() at time zone 'Asia/Seoul')::date$kst$);
end;
$$;
