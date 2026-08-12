-- ============================================================================
-- 로컬 검증용 Supabase 환경 스텁
--
-- ⚠ 이 파일은 마이그레이션이 **아니다.** supabase/migrations/ 밖에 있으므로 실제
-- 프로젝트에는 절대 적용되지 않는다. 목적은 하나다: 맨 Postgres 위에서 마이그레이션을
-- 그대로 적용해 볼 수 있도록, 플랫폼이 미리 만들어 두는 것들(롤·auth·storage)만 흉내낸다.
--
-- 흉내내는 범위는 마이그레이션이 실제로 의존하는 것으로 한정한다:
--   - 롤 3종 (anon / authenticated / service_role)
--   - auth 스키마: users 테이블, uid(), role()
--   - storage 스키마: buckets / objects / foldername()
--
-- ★ 권한 기본값에 대하여
-- 예전 Supabase 는 public 스키마의 새 객체를 API 롤에 자동 노출했지만(auto_expose_new_tables),
-- 현재 클라우드 기본값은 "자동 노출 없음"이다. 여기서도 일부러 default privileges 를 주지
-- 않는다 — 마이그레이션이 필요한 GRANT 를 스스로 다 갖고 있는지 검증하기 위해서다.
-- 이 스텁에서 통과하면 자동 노출이 켜진 환경에서도 당연히 통과한다(더 느슨하므로).
-- ============================================================================

-- Supabase 는 UTC 로 돌아간다. KST 로컬 머신에서 돌려도 같은 조건이 되도록 못 박는다.
-- (이 값이 로컬 타임존이면 40-local-date.test.sql 이 의미를 잃는다.)
set timezone = 'UTC';
alter database postgres set timezone = 'UTC';

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
-- service_role 은 실제로 BYPASSRLS 다. 배치가 RLS 를 우회한다는 전제를 그대로 재현한다.
create role service_role  nologin noinherit bypassrls;

grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- auth 스키마
-- ----------------------------------------------------------------------------

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- 실제 auth.uid() 와 같은 구현: 요청 JWT 클레임의 sub 를 읽는다.
-- 테스트에서는 test.as_user() 가 request.jwt.claims GUC 를 직접 세팅한다.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- storage 스키마 (20260811120500_storage_record_photos.sql 이 정책을 건다)
-- ----------------------------------------------------------------------------

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets (id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- 실제 storage.foldername 과 같은 의미: 경로에서 파일명을 뺀 디렉터리 세그먼트 배열.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;

-- storage 는 public 스키마와 달리 플랫폼이 직접 권한을 준다(정책으로만 통제).
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
