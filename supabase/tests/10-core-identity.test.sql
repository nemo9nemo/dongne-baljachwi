-- ============================================================================
-- 10. 코어 아이덴티티 — profiles / couples / couple_members / current_couple_id()
--
-- 근거: 00-data-model.md §4.1~§4.4, AC-01/AC-04/AC-05/AC-06
--       01-auth-couple-link.md F-05
--
-- 픽스처
--   커플 A(...00aa): alice(...00a1, owner) + bob(...00a2, partner)
--   커플 B(...00bb): carol(...00b1, owner)
--   dave(...00c1): 커플 미연결
-- ============================================================================

select test.reset();

select test.signup('00000000-0000-0000-0000-0000000000a1', 'alice@example.com');
select test.signup('00000000-0000-0000-0000-0000000000a2', 'bob@example.com');
select test.signup('00000000-0000-0000-0000-0000000000b1', 'carol@example.com');
select test.signup('00000000-0000-0000-0000-0000000000c1', 'dave@example.com');

-- F-05: 가입 트리거. 온보딩 전에도 display_name 이 비어 있으면 안 된다.
select test.eq('F-05: 가입 시 profiles 자동 생성, display_name = 이메일 로컬파트',
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'alice');

insert into public.couples (id, started_on, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', current_date - 100, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000bb', current_date - 50,  '00000000-0000-0000-0000-0000000000b1');

insert into public.couple_members (couple_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a2', 'partner'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'owner');

-- ── DB 제약 (애플리케이션 검증에 의존하지 않는 부분) ────────────────────────

select test.raises('AC-04: 3번째 멤버는 UNIQUE(couple_id, role) 로 막힌다',
  $q$insert into public.couple_members (couple_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000aa',
             '00000000-0000-0000-0000-0000000000c1', 'owner')$q$,
  '23505');

select test.raises('AC-05: 한 사람이 두 커플에 속할 수 없다 (UNIQUE user_id)',
  $q$insert into public.couple_members (couple_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000bb',
             '00000000-0000-0000-0000-0000000000a1', 'partner')$q$,
  '23505');

select test.raises('couples_dissolved_fields: dissolved 인데 purge_after 가 없는 행은 만들 수 없다',
  $q$update public.couples set status = 'dissolved'
      where id = '00000000-0000-0000-0000-0000000000bb'$q$,
  '23514');

-- ── current_couple_id() (D-03/D-04) ────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

select test.eq('D-03: current_couple_id() 는 내 활성 커플을 돌려준다',
  public.current_couple_id()::text, '00000000-0000-0000-0000-0000000000aa');

-- ── RLS: 커플 격리 ─────────────────────────────────────────────────────────

select test.eq('profiles: 나와 상대만 보인다 (다른 커플 프로필은 0행)',
  (select count(*) from public.profiles)::text, '2');

select test.eq('couples: 내 커플 1행만 보인다',
  (select count(*) from public.couples)::text, '1');

select test.eq('couple_members: 내 커플 멤버십 2행만 보인다',
  (select count(*) from public.couple_members)::text, '2');

-- 남의 프로필 UPDATE 는 에러가 아니라 0행이다 (SELECT/UPDATE 정책은 조용히 걸러낸다).
with u as (
  update public.profiles set display_name = 'hacked'
   where id = '00000000-0000-0000-0000-0000000000b1'
  returning 1
)
select test.eq('profiles: 남의 프로필 UPDATE 는 0행',
  (select count(*) from u)::text, '0');

with u as (
  update public.profiles set display_name = '앨리스'
   where id = '00000000-0000-0000-0000-0000000000a1'
  returning 1
)
select test.eq('profiles: 내 display_name 은 수정된다',
  (select count(*) from u)::text, '1');

select test.raises('profiles: 클라이언트 INSERT 금지 (트리거로만 생성)',
  $q$insert into public.profiles (id, display_name)
     values (gen_random_uuid(), 'ghost')$q$,
  '42501');

select test.raises('profiles: 클라이언트 DELETE 금지 (auth.users CASCADE 로만)',
  $q$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$q$,
  '42501');

-- ── 컬럼 단위 권한: 생애주기 컬럼 잠금 ──────────────────────────────────────
-- 이게 없으면 클라이언트가 status 만 직접 바꿔 "반쪽 해제" 상태를 만들 수 있다.

select test.raises('couples: status 직접 UPDATE 금지 (컬럼 권한)',
  $q$update public.couples set status = 'dissolved'
      where id = '00000000-0000-0000-0000-0000000000aa'$q$,
  '42501');

with u as (
  update public.couples set started_on = current_date - 200
   where id = '00000000-0000-0000-0000-0000000000aa'
  returning 1
)
select test.eq('couples: started_on 은 수정 가능 (프로필 화면에서 사귄 날 수정)',
  (select count(*) from u)::text, '1');

select test.raises('couple_members: 클라이언트 INSERT 전면 금지 (함수 경로만)',
  $q$insert into public.couple_members (couple_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000aa',
             '00000000-0000-0000-0000-0000000000c1', 'partner')$q$,
  '42501');

select test.raises('couple_members: 클라이언트 DELETE 전면 금지',
  $q$delete from public.couple_members
      where user_id = '00000000-0000-0000-0000-0000000000a2'$q$,
  '42501');

-- 이미 커플이 있는 사용자는 새 커플을 만들 수 없다 (RLS WITH CHECK).
select test.raises('couples: 이미 커플이 있으면 INSERT 가 정책에 걸린다',
  $q$insert into public.couples (started_on, created_by)
     values (current_date, '00000000-0000-0000-0000-0000000000a1')$q$,
  '42501');

-- ── 미연결 사용자 ──────────────────────────────────────────────────────────

select test.as_user('00000000-0000-0000-0000-0000000000c1');

select test.ok('미연결 사용자의 current_couple_id() 는 NULL',
  public.current_couple_id() is null);

select test.eq('미연결 사용자에게 couples 는 0행 (RLS 거부와 빈 결과는 구분되지 않는다)',
  (select count(*) from public.couples)::text, '0');

select test.eq('미연결 사용자에게 보이는 프로필은 자기 자신뿐',
  (select count(*) from public.profiles)::text, '1');

-- ── anon ───────────────────────────────────────────────────────────────────

reset role;
select test.as_anon();
set role anon;

select test.raises('anon 은 profiles 에 접근할 수 없다 (권한 자체를 회수)',
  'select count(*) from public.profiles', '42501');
select test.raises('anon 은 couples 에 접근할 수 없다',
  'select count(*) from public.couples', '42501');
select test.raises('anon 은 records 에 접근할 수 없다',
  'select count(*) from public.records', '42501');

-- ── AC-06: 해제된 커플 ─────────────────────────────────────────────────────
-- 멤버십 행이 남아 있어도 status 가 active 가 아니면 접근이 끊겨야 한다
-- (dissolve_couple 은 멤버십도 지우지만, 그 사이 상태나 향후 status 추가까지 방어).

reset role;
update public.couples
   set status = 'dissolved', dissolved_at = now(), purge_after = now() + interval '30 days'
 where id = '00000000-0000-0000-0000-0000000000aa';

select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

select test.ok('AC-06: 해제된 커플의 멤버는 current_couple_id() 가 NULL 이다',
  public.current_couple_id() is null);

select test.eq('AC-06: 해제 후 couples 조회는 0행',
  (select count(*) from public.couples)::text, '0');

reset role;
