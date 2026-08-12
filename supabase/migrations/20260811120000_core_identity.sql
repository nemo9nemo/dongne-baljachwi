-- ============================================================================
-- 코어 아이덴티티: profiles / couples / couple_members / current_couple_id()
--
-- 근거: docs/specs/00-data-model.md §4.1~§4.4 (D-01~D-13)
--       docs/decisions/002-rls-only-authorization.md
--
-- 이 파일이 전체 인가 체계의 뿌리다. 서버 미들웨어가 없으므로 여기서 뚫리면
-- 다른 어떤 계층도 막아주지 못한다. 테이블 생성과 RLS 정책을 같은 마이그레이션에
-- 넣는 것도 "정책 없는 노출 구간 0초"를 위해서다 (00 §6).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 공통 트리거 함수
-- ----------------------------------------------------------------------------

-- D-07: updated_at 은 항상 DB가 정한다. 클라이언트가 보낸 값은 덮어써서 무시한다.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'updated_at 자동 갱신 트리거 (D-07). 클라이언트가 보낸 updated_at 은 무시한다.';

-- ----------------------------------------------------------------------------
-- profiles (00 §4.1)
-- ----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- F-06: 1~12자. 기록의 "누가 썼는지" 표시에 쓰이므로 빈 문자열을 허용하지 않는다.
  display_name text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 12)
);

comment on table public.profiles is
  'auth.users 1:1 프로필. 이메일은 복제하지 않는다 — auth.users 가 단일 출처 (00 §4.1).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- F-05: 가입 직후 프로필 행 자동 생성. 온보딩 전에도 display_name 이 비어 있지 않게 한다.
-- SECURITY DEFINER 인 이유: auth.users 트리거는 Auth 서비스 롤 컨텍스트에서 실행되며
-- 그 롤에는 public.profiles INSERT 권한이 없다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- F-05: 초기값 = 이메일 로컬파트 앞 12자. 이메일이 없는 가입 경로(향후 소셜 등)도
  -- 고려해 폴백을 둔다 — display_name 은 NOT NULL 이므로 여기서 비면 가입 자체가 실패한다.
  v_name := left(split_part(coalesce(new.email, ''), '@', 1), 12);
  if char_length(v_name) = 0 then
    v_name := '이름없음';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;   -- 재실행/복구 시 중복 생성 방지

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- couples (00 §4.2)
-- ----------------------------------------------------------------------------

create table public.couples (
  id           uuid        primary key default gen_random_uuid(),
  started_on   date        not null,
  status       text        not null default 'active',
  dissolved_at timestamptz,
  purge_after  timestamptz,
  created_by   uuid        not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- D-09: 열거값은 enum 타입이 아니라 text + CHECK. 값 추가가 마이그레이션 1줄이 된다.
  constraint couples_status_valid check (status in ('active', 'dissolved')),

  -- F-07: 사귄 날은 미래일 수 없다.
  --
  -- ⚠ "오늘"의 판정은 서버가 하지 않는다 (D-13). DB 세션은 UTC 고 사용자는 KST(UTC+9)라,
  -- KST 00:00~08:59 에는 사용자가 고른 "오늘"이 서버의 current_date 기준으로는 내일이다.
  -- current_date 로 그대로 비교하면 매일 그 9시간 동안 오늘 날짜 입력이 거부된다(실측 확인).
  -- 그래서 이 제약은 "달력상 오늘"이 아니라 **오타·장난 입력을 걸러내는 상한**으로만 쓴다.
  -- +1일이면 지구상 어떤 타임존(최대 UTC+14)의 로컬 날짜도 UTC 날짜+1 을 넘지 않으므로
  -- 정상 사용자를 거부하지 않는다. 정확한 "오늘" 상한은 클라이언트가 date input 의 max 로 준다.
  --
  -- current_date 는 immutable 이 아니지만, 제약이 시간이 갈수록 "느슨해지는" 방향이라
  -- 한 번 통과한 행이 나중에 위반이 되는 일은 없다(덤프/복원 안전).
  constraint couples_started_on_not_future check (started_on <= current_date + 1),

  -- 상태와 시각 컬럼의 정합성을 DB가 강제한다.
  -- 이게 없으면 "dissolved 인데 purge_after 가 NULL" 인 행이 생겨 정리 배치가 영원히 건너뛴다.
  constraint couples_dissolved_fields check (
       (status = 'active'    and dissolved_at is null     and purge_after is null)
    or (status = 'dissolved' and dissolved_at is not null and purge_after is not null)
  )
);

comment on table public.couples is
  '커플. 멤버 1명 상태도 active 다 — "상대 합류 대기"는 별도 status 가 아니라 member_count=1 로 파생한다 (00 §4.2).';

create trigger couples_set_updated_at
  before update on public.couples
  for each row execute function public.set_updated_at();

-- 접근 패턴: 30일 경과 커플 영구 삭제 배치(F-21)가 purge_after < now() 로 스캔한다.
-- 해제된 커플만 대상이므로 부분 인덱스로 크기를 최소화한다.
create index couples_purge_after_idx
  on public.couples (purge_after)
  where status = 'dissolved';

-- ----------------------------------------------------------------------------
-- couple_members (00 §4.3) — 커플 격리의 뿌리
-- ----------------------------------------------------------------------------

create table public.couple_members (
  couple_id uuid        not null references public.couples (id)  on delete cascade,
  user_id   uuid        not null references public.profiles (id) on delete cascade,
  role      text        not null,
  joined_at timestamptz not null default now(),

  primary key (couple_id, user_id),

  constraint couple_members_role_valid check (role in ('owner', 'partner')),

  -- 커플당 최대 2명: 역할이 2종뿐이므로 (couple_id, role) 유니크가 곧 인원 상한이다.
  -- 초대 코드가 유출돼 3명째가 합류하는 사고를 애플리케이션이 아니라 DB가 막는다 (00 §4.3, AC-04).
  constraint couple_members_one_role_per_couple unique (couple_id, role),

  -- 한 사람은 한 커플만. 동시에 두 커플에 속해 기록이 섞이는 사고를 막는다 (AC-05).
  -- 이 유니크 인덱스는 current_couple_id() 의 user_id 조회 인덱스 역할도 겸한다.
  constraint couple_members_one_couple_per_user unique (user_id)
);

comment on table public.couple_members is
  '커플 멤버십. INSERT/UPDATE/DELETE 는 create_couple / redeem_invite / dissolve_couple 함수로만 (ADR-002).';

-- ----------------------------------------------------------------------------
-- current_couple_id() (00 §4.4, D-03/D-04)
-- ----------------------------------------------------------------------------

-- 모든 사용자 데이터 테이블의 RLS 정책은 예외 없이 `couple_id = current_couple_id()`
-- 한 가지 표현식만 쓴다. 정책마다 서브쿼리를 복붙하면 한 군데만 틀려도 구멍이 된다 (D-03).
--
-- SECURITY DEFINER 인 이유(D-04): couple_members 의 RLS 정책이 다시 couple_members 를
-- 조회하면 정책 평가가 무한 재귀한다. DEFINER 함수는 RLS를 우회하므로 재귀가 끊긴다.
--
-- status='active' 를 조건에 넣은 이유: 해제된 커플은 멤버십 행이 삭제되므로 이미 NULL 이
-- 되지만, 삭제 전 시점이나 향후 status 값이 늘어나는 경우까지 방어한다 (F-21, AC-06).
create or replace function public.current_couple_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.couple_id
  from public.couple_members cm
  join public.couples c on c.id = cm.couple_id
  where cm.user_id = (select auth.uid())
    and c.status = 'active'
$$;

comment on function public.current_couple_id() is
  '현재 로그인 사용자의 활성 커플 id. 미연결/해제 시 NULL — 이때 모든 정책이 자동으로 0행이 된다 (00 §4.4).';

revoke all on function public.current_couple_id() from public;
grant execute on function public.current_couple_id() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS — profiles
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- anon 은 어떤 사용자 데이터에도 접근할 이유가 없다. 정책 이전에 권한 자체를 회수한다.
revoke all on public.profiles from anon;

-- ⚠ 테이블 권한을 명시적으로 부여한다. Supabase 는 예전에 public 스키마의 새 객체를
-- anon/authenticated/service_role 에 자동 노출했지만(`auto_expose_new_tables`), 현재 클라우드
-- 기본값은 "자동 노출 없음"이고 그 옵션은 2026-10-30 에 제거된다 (supabase/config.toml 참조).
-- 즉 revoke 만 적어 두면 새 프로젝트에서는 모든 테이블이 권한 자체가 없어 앱 전체가 42501 이 된다.
-- 정책(RLS)과 권한(GRANT)은 다른 층이므로 둘 다 이 마이그레이션이 소유한다.
grant select on public.profiles to authenticated;

-- 상대방 이름을 기록 카드에 표시해야 하므로 같은 커플 멤버의 프로필까지 읽을 수 있어야 한다.
-- couple_members 서브쿼리 자체도 RLS가 걸려 있어(자기 커플만 보임) 범위가 이중으로 제한된다.
-- auth.uid()/current_couple_id() 를 (select ...) 로 감싼 이유: 행마다 재평가되지 않고
-- InitPlan 으로 1회만 계산되게 하기 위해서다 (Supabase RLS 성능 가이드).
create policy profiles_select_self_or_partner on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.couple_members cm
      where cm.user_id = profiles.id
        and cm.couple_id = (select public.current_couple_id())
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- INSERT/DELETE 정책 없음 = 클라이언트 금지. 생성은 handle_new_user 트리거,
-- 삭제는 auth.users CASCADE 로만 일어난다 (00 §4.1).
-- 정책이 없어도 테이블 권한이 남아 있으면 오해를 부르므로 권한도 함께 회수한다.
revoke insert, delete, truncate on public.profiles from authenticated;
-- id 는 auth.users FK 이므로 변경 자체가 사고다. 갱신 가능한 컬럼을 명시적으로 좁힌다.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — couples
-- ----------------------------------------------------------------------------

alter table public.couples enable row level security;
revoke all on public.couples from anon;

-- 명시적 권한 부여 (위 profiles 주석 참조). UPDATE 는 아래에서 started_on 컬럼으로 좁힌다.
grant select, insert on public.couples to authenticated;

create policy couples_select_own on public.couples
  for select to authenticated
  using (id = (select public.current_couple_id()));

-- 커플 생성은 create_couple() 함수가 정식 경로지만, 스펙(00 §4.2)이 INSERT 정책을 정의하므로
-- 유지한다. 직접 INSERT 하면 멤버 없는 고아 커플이 생길 뿐 타인 데이터에는 닿지 못한다.
create policy couples_insert_self on public.couples
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and not exists (
      select 1 from public.couple_members cm where cm.user_id = (select auth.uid())
    )
  );

create policy couples_update_own on public.couples
  for update to authenticated
  using (id = (select public.current_couple_id()))
  with check (id = (select public.current_couple_id()));

-- 컬럼 단위 권한으로 생애주기 컬럼을 잠근다.
-- 이게 없으면 클라이언트가 status='dissolved' 만 직접 UPDATE 해서 멤버십 행은 남긴 채
-- 데이터에 접근 불가가 되는 반쪽 해제 상태를 만들 수 있다 (F-20 은 단일 트랜잭션이 전제).
-- 컬럼 권한은 RLS보다 먼저 평가되고, SECURITY DEFINER 함수(dissolve_couple)는 소유자
-- 권한으로 돌기 때문에 영향을 받지 않는다.
revoke update on public.couples from authenticated;
grant update (started_on) on public.couples to authenticated;

-- DELETE 정책 없음 = 클라이언트 금지. 해제는 UPDATE, 영구 삭제는 배치 (00 §4.2).
revoke delete, truncate on public.couples from authenticated;

-- ----------------------------------------------------------------------------
-- RLS — couple_members
-- ----------------------------------------------------------------------------

alter table public.couple_members enable row level security;
revoke all on public.couple_members from anon;

-- 읽기만 준다. 쓰기는 아래 revoke + 정책 부재로 전면 금지 (변경은 SECURITY DEFINER 함수만).
grant select on public.couple_members to authenticated;

create policy couple_members_select_own on public.couple_members
  for select to authenticated
  using (couple_id = (select public.current_couple_id()));

-- INSERT/UPDATE/DELETE 정책 없음 + 권한 회수 = 클라이언트 직접 변경 전면 금지.
-- 멤버십은 인가의 뿌리이므로 변경 경로를 3개 함수로 좁혀야 감사·검증이 가능하다 (ADR-002 4).
revoke insert, update, delete, truncate on public.couple_members from authenticated;
