-- ============================================================================
-- 커플 연결: couple_invites / invite_attempts + 멤버십 변경 함수 4종
--
-- 근거: docs/specs/01-auth-couple-link.md §3 (F-08~F-25), §4.1~§4.3
--       docs/decisions/002-rls-only-authorization.md 4
--
-- ▼ 에러 전달 형태 (프론트와의 계약. 스펙 §4.4 를 구체화한 것이다)
--
-- 실패 페이로드는 어느 경로로 오든 항상 같은 모양이다:
--     { "error_code": "...", "message": "...", "retry_after": <int|null> }
-- 프론트는 `error_code` 로만 분기한다. `message` 는 로깅용이고 화면 문구는 프론트 소유다.
--
-- 전달 경로는 함수에 따라 둘로 갈린다. **이 차이는 취향이 아니라 Postgres 의 제약이다.**
--
--  (A) create_couple / issue_invite / dissolve_couple → **예외로 던진다.**
--      `RAISE EXCEPTION USING MESSAGE = <위 JSON 문자열>` 이므로 PostgREST 응답의
--      `error.message` 에 JSON 문자열이 그대로 담긴다. 프론트는 JSON.parse(error.message).
--
--  (B) redeem_invite → **같은 모양의 jsonb 를 정상 반환한다 (throw 하지 않는다).**
--      이유: Postgres 에는 자율 트랜잭션이 없다. 실패를 예외로 던지면 같은 트랜잭션에서
--      기록한 invite_attempts 행까지 함께 롤백되어, F-12(1시간 10회 무차별 대입 차단)가
--      **원리적으로 동작할 수 없다.** 실패 카운터가 영원히 0이 되므로 rate limit 이 없는
--      것과 같다. 실패 로그를 남기려면 정상 커밋이 필수이고, 정상 커밋은 곧 "값 반환"이다.
--      → 프론트는 redeem_invite 만 `data.error_code` 유무로 분기해야 한다.
--      (dblink/pg_net 등 우회 수단은 Supabase 호스팅 환경에서 쓸 수 없거나 같은 트랜잭션에
--       묶여 있어 해결책이 되지 못한다.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- couple_invites (01 §4.1)
-- ----------------------------------------------------------------------------

create table public.couple_invites (
  id          uuid        primary key default gen_random_uuid(),
  couple_id   uuid        not null references public.couples (id)  on delete cascade,
  code        text        not null unique,
  created_by  uuid        not null references public.profiles (id),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid        references public.profiles (id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  -- F-09: Crockford Base32 대문자. I, L, O, U 를 제외한 32자만 허용한다.
  -- 코드 생성기와 이 제약이 어긋나면 발급 자체가 실패하도록(조용한 불일치 방지) DB에 박아둔다.
  constraint couple_invites_code_charset check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),

  -- 사용 시각과 사용자는 항상 함께 채워진다. 한쪽만 있는 행은 감사 추적을 깨뜨린다.
  constraint couple_invites_consumed_pair check (
    (consumed_at is null and consumed_by is null)
    or (consumed_at is not null and consumed_by is not null)
  )
);

comment on table public.couple_invites is
  '초대 코드. 코드는 해시하지 않는다 — 72시간/1회용/rate limit 이 있고 발급자가 화면에서 다시 봐야 한다 (01 §4.1).';

-- F-08: 커플당 "동시에 유효한 코드 1개"를 DB가 강제한다.
-- 애플리케이션 검증에 맡기면 두 기기에서 동시에 발급 시 두 개가 살아남는다 (01 §9).
create unique index couple_invites_one_active_per_couple
  on public.couple_invites (couple_id)
  where consumed_at is null and revoked_at is null;

-- 접근 패턴: redeem_invite 가 정규화된 code 로 단건 조회한다. UNIQUE(code) 인덱스가 그대로 쓰인다.

alter table public.couple_invites enable row level security;
revoke all on public.couple_invites from anon;

-- F-18: 발급자가 자기 코드를 다시 확인할 수 있어야 한다.
-- 미연결 사용자는 current_couple_id() 가 NULL 이라 어떤 초대 행도 볼 수 없다 → F-14(코드
-- 미리보기 금지)가 자동으로 성립한다. 검증은 오직 redeem_invite 함수를 통해서만 (F-13).
create policy couple_invites_select_own on public.couple_invites
  for select to authenticated
  using (couple_id = (select public.current_couple_id()));

revoke insert, update, delete, truncate on public.couple_invites from authenticated;
-- 명시적 권한 부여 (20260811120000_core_identity.sql 의 profiles 주석 참조).
grant select on public.couple_invites to authenticated;

-- ----------------------------------------------------------------------------
-- invite_attempts (01 §4.2) — 무차별 대입 방어 로그
-- ----------------------------------------------------------------------------

create table public.invite_attempts (
  id           bigint      generated always as identity primary key,
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  succeeded    boolean     not null,
  attempted_at timestamptz not null default now()
);

comment on table public.invite_attempts is
  '초대 코드 시도 로그. 입력된 코드 값은 저장하지 않는다 — 다른 커플의 유효 코드가 로그에 남는 걸 막기 위해 (01 §4.2).';

-- 접근 패턴: F-12 rate limit 이 "특정 사용자의 최근 1시간 실패"만 센다.
-- 실패 행만 대상이므로 부분 인덱스로 성공 로그를 제외한다.
create index invite_attempts_user_recent_failures_idx
  on public.invite_attempts (user_id, attempted_at desc)
  where succeeded = false;

alter table public.invite_attempts enable row level security;

-- 정책 없음 + 권한 전면 회수 = 클라이언트는 읽지도 쓰지도 못한다.
-- redeem_invite(SECURITY DEFINER) 내부에서만 기록된다. 클라이언트가 직접 INSERT 할 수 있으면
-- 스스로 rate limit 을 조작하거나 남의 카운터를 채울 수 있다.
revoke all on public.invite_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 공통 헬퍼
-- ----------------------------------------------------------------------------

-- 실패 응답 봉투(01 §4.4). 20여 개 분기에서 같은 모양을 만들어야 해서 함수로 뽑았다.
-- json_build_object(jsonb 아님)를 쓰는 이유: jsonb 는 키 순서를 재정렬해서 로그에서
-- error_code 를 눈으로 찾기 나빠진다. 파싱에는 영향이 없다.
create or replace function public.app_error(
  p_code        text,
  p_message     text,
  p_retry_after int default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select json_build_object(
    'error_code',  p_code,
    'message',     p_message,
    'retry_after', p_retry_after
  )::jsonb;
$$;

revoke all on function public.app_error(text, text, int) from public, anon, authenticated;

-- 위 (A) 경로: 봉투 JSON 을 예외 메시지 본문에 그대로 실어 던진다.
-- PostgREST 는 이 문자열을 응답의 `message` 필드로 내보낸다 → 프론트는 JSON.parse(error.message).
-- detail/hint 는 일부러 비워 둔다. 파싱 지점이 둘이 되면 프론트가 또 관용 파싱을 해야 한다.
create or replace function public.app_raise(
  p_code        text,
  p_message     text,
  p_retry_after int default null
)
returns void
language plpgsql
volatile     -- 예외를 던지는 함수라 상수 폴딩 대상이 되면 안 된다
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',   -- raise_exception → PostgREST 400
    message = json_build_object(
      'error_code',  p_code,
      'message',     p_message,
      'retry_after', p_retry_after
    )::text;
end;
$$;

revoke all on function public.app_raise(text, text, int) from public, anon, authenticated;

-- F-09: Crockford Base32(대문자, I/L/O/U 제외) 8자 코드 생성.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- 0-9 + A-Z 에서 I, L, O, U 를 뺀 정확히 32자. 손으로 옮겨 적을 때의 0/O, 1/I/L 혼동 방지.
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bits bigint;
  v_code text := '';
begin
  -- 32^8 = 2^40 이므로 40비트가 정확히 코드 1개다.
  -- random() 대신 gen_random_uuid() 를 쓰는 이유: 초대 코드는 사실상 접근 토큰이라
  -- 예측 가능한 PRNG 를 쓰면 안 된다. gen_random_uuid() 는 CSPRNG 기반이고 pgcrypto
  -- 설치 위치(extensions 스키마)에 의존하지 않는 pg_catalog 내장 함수다.
  v_bits := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))::bit(40)::bigint;

  for _i in 1..8 loop
    v_code := substr(c_alphabet, (v_bits % 32)::int + 1, 1) || v_code;
    v_bits := v_bits / 32;
  end loop;

  return v_code;
end;
$$;

revoke all on function public.generate_invite_code() from public, anon, authenticated;

-- F-08/F-11: 기존 유효 코드를 무효화하고 새 코드를 발급한다.
-- create_couple 과 issue_invite 두 곳에서 쓰이므로 함수로 분리했다.
-- 반환값 NULL = 코드 충돌로 5회 연속 실패 (호출자가 롤백을 결정한다).
create or replace function public.issue_invite_code(
  p_couple_id  uuid,
  p_created_by uuid
)
returns public.couple_invites
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.couple_invites;
begin
  -- F-08: 재발급 시 기존 코드 즉시 무효화. 부분 유니크 인덱스가 있으므로 이 선행 UPDATE 가
  -- 없으면 아래 INSERT 가 반드시 충돌한다.
  update public.couple_invites
     set revoked_at = now()
   where couple_id = p_couple_id
     and consumed_at is null
     and revoked_at is null;

  for _attempt in 1..5 loop
    begin
      insert into public.couple_invites (couple_id, code, created_by, expires_at)
      values (
        p_couple_id,
        public.generate_invite_code(),
        p_created_by,
        now() + interval '72 hours'   -- F-11
      )
      returning * into v_invite;

      return v_invite;
    exception
      -- 40비트 공간에서 코드 충돌은 사실상 발생하지 않지만, 발생 시 조용히 실패하는 대신
      -- 재생성한다. 서브트랜잭션이므로 실패한 INSERT 만 롤백된다.
      when unique_violation then
        null;
    end;
  end loop;

  return null;
end;
$$;

revoke all on function public.issue_invite_code(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_couple (01 §4.3)
-- ----------------------------------------------------------------------------

create or replace function public.create_couple(
  p_started_on   date,
  p_display_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_name      text := btrim(coalesce(p_display_name, ''));
  v_couple_id uuid;
  v_invite    public.couple_invites;
begin
  if v_uid is null then
    perform public.app_raise('UNAUTHENTICATED', 'no authenticated user');
  end if;

  -- F-16: 이미 커플에 속하면 발급 불가. DB의 UNIQUE(user_id) 로도 이중 방어된다.
  if exists (select 1 from public.couple_members cm where cm.user_id = v_uid) then
    perform public.app_raise('ALREADY_IN_COUPLE', 'caller already belongs to a couple');
  end if;

  -- F-07: 사귄 날은 필수이고 미래일 수 없다.
  -- 상한이 current_date 가 아니라 +1 인 이유는 couples_started_on_not_future 제약과 같다:
  -- 서버는 UTC, 사용자는 KST 라 KST 새벽에는 사용자의 "오늘"이 서버 기준 내일이다 (D-13).
  -- 제약보다 여기서 더 빡빡하게 잡으면 "제약은 통과하는데 함수는 거부"하는 모순이 생기므로
  -- 두 값은 반드시 같이 움직여야 한다.
  if p_started_on is null or p_started_on > current_date + 1 then
    perform public.app_raise('INVALID_START_DATE', 'started_on must be today or earlier');
  end if;

  -- F-06: 1~12자
  if char_length(v_name) < 1 or char_length(v_name) > 12 then
    perform public.app_raise('INVALID_DISPLAY_NAME', 'display_name must be 1..12 characters');
  end if;

  update public.profiles set display_name = v_name where id = v_uid;

  insert into public.couples (started_on, created_by)
  values (p_started_on, v_uid)
  returning id into v_couple_id;

  insert into public.couple_members (couple_id, user_id, role)
  values (v_couple_id, v_uid, 'owner');

  v_invite := public.issue_invite_code(v_couple_id, v_uid);

  if v_invite.id is null then
    -- 예외가 트랜잭션 전체를 롤백시킨다. 여기서 정상 반환하면 커플·멤버십만 커밋되고
    -- 코드가 없는 반쪽 상태가 된다 (01 §5 "부분 성공은 존재하지 않는다").
    perform public.app_raise('CODE_GENERATION_FAILED', 'invite code generation failed');
  end if;

  return json_build_object(
    'couple_id',  v_couple_id,
    'code',       v_invite.code,
    'expires_at', v_invite.expires_at
  )::jsonb;
end;
$$;

comment on function public.create_couple(date, text) is
  '커플 생성 + owner 멤버십 + 초대 코드 발급을 단일 트랜잭션으로 수행 (01 §4.3, AC-03).';

revoke all on function public.create_couple(date, text) from public, anon;
grant execute on function public.create_couple(date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- issue_invite (01 §4.3) — 코드 재발급 / 재확인용 신규 발급
-- ----------------------------------------------------------------------------

create or replace function public.issue_invite()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_couple_id uuid := (select public.current_couple_id());
  v_members   int;
  v_invite    public.couple_invites;
begin
  if v_uid is null then
    perform public.app_raise('UNAUTHENTICATED', 'no authenticated user');
  end if;

  if v_couple_id is null then
    perform public.app_raise('NOT_IN_COUPLE', 'caller does not belong to an active couple');
  end if;

  select count(*) into v_members
  from public.couple_members cm
  where cm.couple_id = v_couple_id;

  -- 이미 2명이면 초대할 상대가 없다. 발급된 코드가 떠돌 이유를 만들지 않는다.
  if v_members <> 1 then
    perform public.app_raise('COUPLE_ALREADY_FULL', 'couple already has two members');
  end if;

  v_invite := public.issue_invite_code(v_couple_id, v_uid);

  if v_invite.id is null then
    -- 롤백해야 기존 코드의 revoked_at 도 되돌아간다. 정상 반환하면 "옛 코드는 죽고
    -- 새 코드는 없는" 상태로 커밋된다.
    perform public.app_raise('CODE_GENERATION_FAILED', 'invite code generation failed');
  end if;

  return json_build_object(
    'code',       v_invite.code,
    'expires_at', v_invite.expires_at
  )::jsonb;
end;
$$;

comment on function public.issue_invite() is
  '초대 코드 재발급. 기존 유효 코드는 즉시 revoke 된다 (F-08, AC-04).';

revoke all on function public.issue_invite() from public, anon;
grant execute on function public.issue_invite() to authenticated;

-- ----------------------------------------------------------------------------
-- redeem_invite (01 §4.3) — F-13: 코드 검증/연결의 유일한 경로
--
-- ⚠ 이 함수만 실패를 **예외가 아니라 정상 반환값**으로 돌려준다 (파일 상단 (B) 참조).
-- 실패할 때마다 invite_attempts 에 행을 남겨야 F-12 rate limit 이 성립하는데, 예외를
-- 던지면 그 행이 함께 롤백되어 카운터가 영원히 0이 된다. 프론트는 이 호출만
-- `data.error_code` 유무로 분기한다.
-- ----------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_code         text,
  p_display_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_fail_window  constant interval := interval '1 hour';  -- F-12
  c_fail_limit   constant int      := 10;                 -- F-12

  v_uid          uuid := (select auth.uid());
  v_name         text := btrim(coalesce(p_display_name, ''));
  v_code         text;
  v_fail_count   int;
  v_oldest_fail  timestamptz;
  v_retry_after  int;
  v_invite       public.couple_invites;
  v_couple       public.couples;
  v_members      int;
  v_partner_name text;
begin
  if v_uid is null then
    return public.app_error('UNAUTHENTICATED', 'no authenticated user');
  end if;

  -- F-12: 사용자당 1시간 10회 실패 시 차단. 코드 공간이 32^8 이라 대입 성공 확률 자체는
  -- 무시할 수준이지만, 시도 자체를 막아 열거 공격의 비용을 올린다.
  select count(*), min(a.attempted_at)
    into v_fail_count, v_oldest_fail
  from public.invite_attempts a
  where a.user_id = v_uid
    and a.succeeded = false
    and a.attempted_at > now() - c_fail_window;

  if v_fail_count >= c_fail_limit then
    -- 가장 오래된 실패가 윈도우 밖으로 나가는 순간 카운트가 한도 아래로 내려간다.
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_fail + c_fail_window - now())))::int);
    -- 차단 자체는 실패로 기록하지 않는다. 기록하면 윈도우가 영원히 갱신되어 풀리지 않는다.
    return public.app_error('RATE_LIMITED', 'too many failed attempts', v_retry_after);
  end if;

  -- F-10: 정규화를 함수 내부에서 다시 수행한다 — 클라이언트 정규화를 신뢰하지 않는다.
  -- 공백·하이픈 등 구분자 제거 → 대문자 → 사람이 잘못 읽기 쉬운 글자 교정(O→0, I/L→1).
  -- 부작용 없는 문자열 처리라 아래 검증 순서에 영향을 주지 않는다.
  v_code := translate(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');

  -- F-16
  if exists (select 1 from public.couple_members cm where cm.user_id = v_uid) then
    -- F-15/AC-08: 발급자는 항상 자기 커플의 멤버다. 스펙 §4.3 의 검사 순서를 글자 그대로
    -- 따르면 ALREADY_IN_COUPLE 이 먼저 걸려 OWN_CODE 는 영원히 반환되지 않고, AC-08 이
    -- 성립하지 않는다. "자기가 만든 코드"일 때만 더 구체적인 코드를 돌려준다 —
    -- 남의 코드에 대해서는 존재 여부조차 알려주지 않으므로 열거 공격 표면은 늘지 않는다.
    if exists (
      select 1 from public.couple_invites i
      where i.code = v_code and i.created_by = v_uid
    ) then
      return public.app_error('OWN_CODE', 'cannot redeem your own invite code');
    end if;
    return public.app_error('ALREADY_IN_COUPLE', 'caller already belongs to a couple');
  end if;

  if v_code !~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    -- 길이/문자셋이 아예 안 맞으면 조회할 것도 없다. 다만 무차별 대입 시도로 카운트한다.
    insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
    return public.app_error('CODE_NOT_FOUND', 'code not found');
  end if;

  select * into v_invite from public.couple_invites i where i.code = v_code;

  if v_invite.id is null then
    insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
    return public.app_error('CODE_NOT_FOUND', 'code not found');
  end if;

  -- 검증 순서는 스펙 §4.3 표를 그대로 따른다 (미사용 → 미무효 → 미만료).
  if v_invite.consumed_at is not null then
    insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
    return public.app_error('CODE_USED', 'code already used');
  end if;

  if v_invite.revoked_at is not null then
    insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
    return public.app_error('CODE_REVOKED', 'code revoked by a newer one');
  end if;

  if v_invite.expires_at <= now() then
    insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
    return public.app_error('CODE_EXPIRED', 'code expired');
  end if;

  -- F-15: 자기 코드 사용 금지. 실패로 카운트하지 않는다 — 무차별 대입이 아니라 단순 오조작이다.
  if v_invite.created_by = v_uid then
    return public.app_error('OWN_CODE', 'cannot redeem your own invite code');
  end if;

  select * into v_couple from public.couples c where c.id = v_invite.couple_id;

  if v_couple.status <> 'active' then
    return public.app_error('COUPLE_DISSOLVED', 'target couple is dissolved');
  end if;

  select count(*) into v_members
  from public.couple_members cm
  where cm.couple_id = v_couple.id;

  if v_members <> 1 then
    return public.app_error('COUPLE_ALREADY_FULL', 'couple already has two members');
  end if;

  -- F-06. 스펙 §4.3 표에는 없지만 create_couple 과 같은 제약을 적용한다 — 여기서 통과시키면
  -- profiles CHECK 위반으로 원시 예외가 나가 프론트가 error_code 로 분기할 수 없다.
  if char_length(v_name) < 1 or char_length(v_name) > 12 then
    return public.app_error('INVALID_DISPLAY_NAME', 'display_name must be 1..12 characters');
  end if;

  update public.profiles set display_name = v_name where id = v_uid;

  -- 동시성 경계: 두 사람이 같은 코드를 동시에 입력하면 위 count 검사를 둘 다 통과할 수 있다.
  -- 최종 판정은 UNIQUE(couple_id, role) / UNIQUE(user_id) 가 한다. 원시 제약 위반이 프론트로
  -- 새어 나가지 않도록 여기서 잡아 스펙상의 error_code 로 변환한다 (AC-09).
  begin
    insert into public.couple_members (couple_id, user_id, role)
    values (v_couple.id, v_uid, 'partner');
  exception
    when unique_violation then
      insert into public.invite_attempts (user_id, succeeded) values (v_uid, false);
      return public.app_error('COUPLE_ALREADY_FULL', 'couple already has two members');
  end;

  update public.couple_invites
     set consumed_at = now(),
         consumed_by = v_uid
   where id = v_invite.id;

  insert into public.invite_attempts (user_id, succeeded) values (v_uid, true);

  -- F-14: 상대 이름은 연결이 끝난 뒤에만 알려준다.
  select p.display_name into v_partner_name
  from public.couple_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.couple_id = v_couple.id
    and cm.user_id <> v_uid;

  return json_build_object(
    'couple_id',            v_couple.id,
    'partner_display_name', v_partner_name
  )::jsonb;
end;
$$;

comment on function public.redeem_invite(text, text) is
  '초대 코드 검증 + partner 멤버십 생성. 코드 검증의 유일한 경로다 (F-13).';

revoke all on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- dissolve_couple (01 §4.3)
-- ----------------------------------------------------------------------------

create or replace function public.dissolve_couple(p_confirm text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- F-23: 오조작 방지용 확인 문구. 01 §9 에서 "상대 이름 vs 고정 문구"가 미결정이라
  -- 감정적 부담이 적은 고정 문구를 택했다. 바뀌면 이 상수 한 줄과 프론트 문구를 함께 고친다.
  c_confirm_phrase constant text := '연결 해제';
  c_retention      constant interval := interval '30 days';  -- F-21

  v_uid         uuid := (select auth.uid());
  v_couple_id   uuid := (select public.current_couple_id());
  v_dissolved_at timestamptz := now();
  v_purge_after  timestamptz;
begin
  if v_uid is null then
    perform public.app_raise('UNAUTHENTICATED', 'no authenticated user');
  end if;

  -- F-19: 한쪽이 단독으로 실행 가능하다. 상대 동의를 요구하면 실제 상황에서 영영 해제 불가가 된다.
  if v_couple_id is null then
    perform public.app_raise('NOT_IN_COUPLE', 'caller does not belong to an active couple');
  end if;

  -- 프론트의 DISSOLVE_CONFIRM_PHRASE 상수와 **글자 단위로 같아야 한다.**
  -- 앞뒤 공백만 관용한다 (모바일 자동 공백 삽입 대응).
  if btrim(coalesce(p_confirm, '')) <> c_confirm_phrase then
    perform public.app_raise('CONFIRM_MISMATCH', 'confirmation phrase does not match');
  end if;

  v_purge_after := v_dissolved_at + c_retention;

  -- F-20: 아래 세 문장은 하나의 트랜잭션이다. 부분 해제 상태가 나올 수 없다.
  update public.couples
     set status       = 'dissolved',
         dissolved_at = v_dissolved_at,
         purge_after  = v_purge_after
   where id = v_couple_id;

  -- F-21: 멤버십을 지우는 순간 current_couple_id() 가 NULL 이 되어 양쪽 모두 즉시 접근 불가가 된다.
  -- 기록·사진·태그는 이 시점에 건드리지 않는다 (AC-13). 삭제는 purge_after 이후 배치 담당.
  delete from public.couple_members where couple_id = v_couple_id;

  -- 떠도는 코드로 해제된 커플에 합류하는 경로를 닫는다.
  update public.couple_invites
     set revoked_at = v_dissolved_at
   where couple_id = v_couple_id
     and consumed_at is null
     and revoked_at is null;

  return json_build_object(
    'dissolved_at', v_dissolved_at,
    'purge_after',  v_purge_after
  )::jsonb;
end;
$$;

comment on function public.dissolve_couple(text) is
  '커플 연결 해제. 확인 문구는 고정 문자열 "연결 해제" (F-19/F-20/F-23). 복구 경로는 제공하지 않는다 (F-22).';

revoke all on function public.dissolve_couple(text) from public, anon;
grant execute on function public.dissolve_couple(text) to authenticated;
