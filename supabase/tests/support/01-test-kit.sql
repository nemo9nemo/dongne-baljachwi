-- ============================================================================
-- 테스트 키트: 어서션 + 세션 시뮬레이션 + 픽스처
--
-- 결과를 예외로 던지지 않고 test.results 에 적재한다. 첫 실패에서 파일 전체가 중단되면
-- "무엇이 몇 개 깨졌는지"를 한 번에 볼 수 없기 때문이다.
--
-- 규칙
--  - 실패를 기대하는 문장은 반드시 test.raises() 로 감싼다. 그냥 실행하면 파일 전체
--    트랜잭션이 어보트되어 그 파일의 결과가 통째로 사라진다.
--  - 롤 전환(set role)과 로그인(test.as_user)은 테스트 파일 최상위에서 한다.
-- ============================================================================

create schema test;
grant usage on schema test to anon, authenticated, service_role;

create table test.results (
  id       bigint generated always as identity primary key,
  file     text    not null,
  name     text    not null,
  passed   boolean not null,
  detail   text
);

-- authenticated 롤로 실행 중에도 결과를 남겨야 하므로 SECURITY DEFINER.
-- 실행 중인 파일 이름은 러너가 GUC(test.file)로 넣는다.
create or replace function test.record(p_name text, p_passed boolean, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into test.results (file, name, passed, detail)
  values (coalesce(current_setting('test.file', true), '?'), p_name, coalesce(p_passed, false), p_detail);
end;
$$;

create or replace function test.ok(p_name text, p_cond boolean)
returns void
language plpgsql
as $$
begin
  perform test.record(
    p_name,
    coalesce(p_cond, false),
    case when coalesce(p_cond, false) then null
         else 'expected true, got ' || coalesce(p_cond::text, 'null') end
  );
end;
$$;

-- 값 비교는 text 로 통일한다. anyelement 다형 함수는 int/text 를 섞어 부르는 순간
-- 함수 해석 에러가 나서 테스트가 아니라 테스트 키트를 디버깅하게 된다.
create or replace function test.eq(p_name text, p_actual text, p_expected text)
returns void
language plpgsql
as $$
begin
  perform test.record(
    p_name,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected then null
         else format('expected %L, got %L', p_expected, p_actual) end
  );
end;
$$;

-- 실패를 기대하는 문장. p_sqlstate 를 주면 에러 코드까지, p_message_like 를 주면 메시지까지
-- 검사한다. app_raise 계열은 전부 P0001 이라 error_code 를 구분하려면 메시지 검사가 필요하다.
-- SECURITY DEFINER 가 아니다 — 호출자 롤 그대로 실행돼야 RLS/권한이 평가된다.
-- SET 절도 붙이지 않는다: 동적 SQL 이 호출자의 search_path 를 그대로 쓰게 하기 위해서다.
create or replace function test.raises(
  p_name         text,
  p_sql          text,
  p_sqlstate     text default null,
  p_message_like text default null
)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
    perform test.record(p_name, false, 'expected an error but the statement succeeded');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  if p_sqlstate is not null and v_state <> p_sqlstate then
    perform test.record(p_name, false,
      format('expected sqlstate %s, got %s (%s)', p_sqlstate, v_state, v_msg));
  elsif p_message_like is not null and v_msg not like p_message_like then
    perform test.record(p_name, false,
      format('expected message like %L, got %L', p_message_like, v_msg));
  else
    perform test.record(p_name, true, v_state || ' ' || coalesce(v_msg, ''));
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 세션 시뮬레이션
-- ----------------------------------------------------------------------------

-- PostgREST 가 요청마다 채우는 request.jwt.claims 를 흉내낸다.
-- is_local=false 라 함수가 끝나도 세션에 남는다(CREATE FUNCTION 의 SET 절 규칙).
create or replace function test.as_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    false
  );
end;
$$;

create or replace function test.as_anon()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 픽스처
-- ----------------------------------------------------------------------------

-- 가입. handle_new_user 트리거가 profiles 행을 만든다 (F-05).
-- id 를 인자로 받는 이유: 테스트 SQL 을 정적으로 유지해 사람이 읽고 재현할 수 있게 하려고.
create or replace function test.signup(p_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into auth.users (id, email) values (p_id, p_email);
  return p_id;
end;
$$;

-- 파일 간 독립성. FK 순서 때문에 자식부터 지운다
-- (records.author_id → profiles 는 CASCADE 가 아니라서 auth.users 를 먼저 지우면 실패한다).
create or replace function test.reset()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects;
  delete from public.record_photos;
  delete from public.record_tags;
  delete from public.records;
  delete from public.couple_invites;
  delete from public.invite_attempts;
  delete from public.couple_members;
  delete from public.couples;
  delete from auth.users;          -- profiles 는 CASCADE

  delete from public.station_lines;
  delete from public.stations;
  delete from public.lines;
  update public.app_settings
     set value = jsonb_build_object('version', 0, 'applied_at', null)
   where key = 'master_version';
end;
$$;

-- 역 마스터 최소 픽스처. records 가 stations 를 FK 로 요구하므로 대부분의 테스트에 필요하다.
create or replace function test.seed_station(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.stations (code, name, name_short, name_key, lat, lng, region_code, source)
  values (p_code, p_name, p_name, lower(p_name), 37.5, 127.0, '11', 'tago')
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on all functions in schema test to anon, authenticated, service_role;
