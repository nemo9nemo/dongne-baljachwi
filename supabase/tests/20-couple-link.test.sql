-- ============================================================================
-- 20. 커플 연결 — create_couple / issue_invite / redeem_invite / dissolve_couple
--
-- 근거: 01-auth-couple-link.md F-06~F-23, AC-03/AC-04/AC-08/AC-09/AC-13
--
-- 시나리오마다 test.reset() 으로 초기화한다. 한 파일 안에서 상태를 이어 붙이면
-- 앞 단계 실패가 뒤 단계 실패로 번져 원인을 못 찾는다.
--
-- 코드처럼 실행 시마다 달라지는 값은 GUC(test.code)에 넣어 다음 문장으로 넘긴다.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 시나리오 1: 생성 → 합류 (정상 흐름 A/B)
-- ────────────────────────────────────────────────────────────────────────────

select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000e1', 'alice@example.com');
select test.signup('00000000-0000-0000-0000-0000000000e2', 'bob@example.com');
select test.signup('00000000-0000-0000-0000-0000000000e3', 'carol@example.com');
select test.signup('00000000-0000-0000-0000-0000000000e4', 'dave@example.com');

select test.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;

select set_config('test.code',
  public.create_couple(current_date - 10, '앨리스') ->> 'code', false);

select test.ok('F-09: 발급 코드는 Crockford Base32 대문자 8자 (I/L/O/U 제외)',
  current_setting('test.code') ~ '^[0-9A-HJKMNP-TV-Z]{8}$');

select test.ok('F-11: 코드 유효기간은 72시간',
  (select expires_at between now() + interval '71 hours' and now() + interval '73 hours'
     from public.couple_invites));

select test.eq('AC-03: create_couple 은 커플 + owner 멤버십을 함께 만든다',
  (select count(*)::text from public.couple_members
    where user_id = '00000000-0000-0000-0000-0000000000e1' and role = 'owner'),
  '1');

select test.eq('F-06: display_name 이 프로필에 반영된다',
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'),
  '앨리스');

select test.eq('F-18: 발급자는 자기 커플의 초대 코드를 다시 볼 수 있다',
  (select count(*)::text from public.couple_invites), '1');

select test.raises('F-16: 이미 커플이 있으면 create_couple 은 ALREADY_IN_COUPLE',
  format('select public.create_couple(%L::date, %L)', current_date - 1, '앨리스'),
  'P0001', '%ALREADY_IN_COUPLE%');

select test.as_user('00000000-0000-0000-0000-0000000000e4');
select test.raises('F-06: display_name 13자는 INVALID_DISPLAY_NAME',
  format('select public.create_couple(%L::date, %L)', current_date - 1, '가나다라마바사아자차카타파'),
  'P0001', '%INVALID_DISPLAY_NAME%');

-- F-14: 미연결 사용자는 남의 초대 행을 볼 수 없다 → 코드 미리보기가 원천 불가능하다.
select test.as_user('00000000-0000-0000-0000-0000000000e2');
select test.eq('F-14: 미연결 사용자에게 couple_invites 는 0행',
  (select count(*)::text from public.couple_invites), '0');

select test.eq('F-13: 없는 코드는 CODE_NOT_FOUND (검증 경로는 redeem_invite 뿐)',
  public.redeem_invite('ZZZZZZZZ', '밥') ->> 'error_code', 'CODE_NOT_FOUND');

select test.eq('F-10: 문자셋이 아예 다른 입력도 CODE_NOT_FOUND 로 통일',
  public.redeem_invite('!!!!', '밥') ->> 'error_code', 'CODE_NOT_FOUND');

-- F-15/AC-08: 발급자 본인이 자기 코드를 넣으면 ALREADY_IN_COUPLE 이 아니라 OWN_CODE.
select test.as_user('00000000-0000-0000-0000-0000000000e1');
select test.eq('AC-08: 자기 코드 입력은 OWN_CODE',
  public.redeem_invite(current_setting('test.code'), '앨리스') ->> 'error_code', 'OWN_CODE');

select test.as_user('00000000-0000-0000-0000-0000000000e2');
select test.eq('F-13/F-14: 합류 성공 시 상대 이름을 돌려준다',
  public.redeem_invite(current_setting('test.code'), '밥') ->> 'partner_display_name', '앨리스');

select test.eq('합류 후 멤버는 2명',
  (select count(*)::text from public.couple_members), '2');

select test.ok('코드는 1회용이다 (consumed_at/consumed_by 가 함께 채워진다)',
  (select consumed_at is not null and consumed_by = '00000000-0000-0000-0000-0000000000e2'
     from public.couple_invites));

select test.as_user('00000000-0000-0000-0000-0000000000e3');
select test.eq('F-13: 이미 사용된 코드는 CODE_USED',
  public.redeem_invite(current_setting('test.code'), '캐롤') ->> 'error_code', 'CODE_USED');

select test.as_user('00000000-0000-0000-0000-0000000000e1');
select test.raises('2명이 찬 커플은 issue_invite 가 COUPLE_ALREADY_FULL',
  'select public.issue_invite()', 'P0001', '%COUPLE_ALREADY_FULL%');

-- ────────────────────────────────────────────────────────────────────────────
-- 시나리오 2: F-10 코드 입력 정규화
--   사용자가 잘못 읽어도(대소문자·하이픈·O/I/L 혼동) 통과해야 한다.
--   코드를 '01ABCDEF' 로 고정해 O→0, I→1 교정이 실제로 일어나는지 결정적으로 본다.
-- ────────────────────────────────────────────────────────────────────────────

reset role;
select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000f1', 'eve@example.com');
select test.signup('00000000-0000-0000-0000-0000000000f2', 'frank@example.com');

select test.as_user('00000000-0000-0000-0000-0000000000f1');
set role authenticated;
select public.create_couple(current_date - 10, '이브');

reset role;
update public.couple_invites set code = '01ABCDEF';
set role authenticated;

select test.as_user('00000000-0000-0000-0000-0000000000f2');
select test.eq('F-10: " oi-abc def " → 01ABCDEF 로 정규화되어 합류에 성공한다',
  public.redeem_invite(' oi-abc def ', '프랭크') ->> 'partner_display_name', '이브');

-- ────────────────────────────────────────────────────────────────────────────
-- 시나리오 3: F-12 무차별 대입 차단 (1시간 10회)
--   실패를 예외가 아니라 반환값으로 주는 설계(파일 상단 (B))가 실제로 카운터를 남기는지
--   확인한다. 예외였다면 invite_attempts 가 함께 롤백되어 아래 숫자가 0이 된다.
-- ────────────────────────────────────────────────────────────────────────────

reset role;
select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000f3', 'grace@example.com');

select test.as_user('00000000-0000-0000-0000-0000000000f3');
set role authenticated;

do $$
begin
  for _i in 1..10 loop
    perform public.redeem_invite('ZZZZZZZZ', '그레이스');
  end loop;
end;
$$;

select test.eq('F-12: 10회 실패 후에는 RATE_LIMITED',
  public.redeem_invite('ZZZZZZZZ', '그레이스') ->> 'error_code', 'RATE_LIMITED');

select test.ok('F-12: retry_after 는 1초 이상 3600초 이하',
  ((public.redeem_invite('ZZZZZZZZ', '그레이스') ->> 'retry_after')::int between 1 and 3600));

reset role;
select test.eq('F-12: 실패 로그가 커밋되어 남아 있다 (10회)',
  (select count(*)::text from public.invite_attempts where succeeded = false), '10');

-- ────────────────────────────────────────────────────────────────────────────
-- 시나리오 4: F-08 재발급 / 만료
-- ────────────────────────────────────────────────────────────────────────────

select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000f4', 'heidi@example.com');
select test.signup('00000000-0000-0000-0000-0000000000f5', 'ivan@example.com');

select test.as_user('00000000-0000-0000-0000-0000000000f4');
set role authenticated;
select set_config('test.code', public.create_couple(current_date - 10, '하이디') ->> 'code', false);
select set_config('test.code2', public.issue_invite() ->> 'code', false);

select test.ok('F-08: 재발급하면 코드가 바뀐다',
  current_setting('test.code') <> current_setting('test.code2'));

select test.eq('F-08: 커플당 동시에 유효한 코드는 1개 (부분 유니크 인덱스)',
  (select count(*)::text from public.couple_invites
    where consumed_at is null and revoked_at is null), '1');

select test.as_user('00000000-0000-0000-0000-0000000000f5');
select test.eq('F-08: 무효화된 이전 코드는 CODE_REVOKED',
  public.redeem_invite(current_setting('test.code'), '아이반') ->> 'error_code', 'CODE_REVOKED');

reset role;
update public.couple_invites set expires_at = now() - interval '1 minute'
 where revoked_at is null;
set role authenticated;

select test.eq('F-11: 만료된 코드는 CODE_EXPIRED',
  public.redeem_invite(current_setting('test.code2'), '아이반') ->> 'error_code', 'CODE_EXPIRED');

-- ────────────────────────────────────────────────────────────────────────────
-- 시나리오 5: F-19~F-23 연결 해제
-- ────────────────────────────────────────────────────────────────────────────

reset role;
select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000f6', 'judy@example.com');
select test.signup('00000000-0000-0000-0000-0000000000f7', 'ken@example.com');

select test.as_user('00000000-0000-0000-0000-0000000000f6');
set role authenticated;
select set_config('test.code', public.create_couple(current_date - 10, '주디') ->> 'code', false);
select test.as_user('00000000-0000-0000-0000-0000000000f7');
select public.redeem_invite(current_setting('test.code'), '켄');

select test.as_user('00000000-0000-0000-0000-0000000000f6');
select test.raises('F-23: 확인 문구가 다르면 CONFIRM_MISMATCH',
  $q$select public.dissolve_couple('해제')$q$, 'P0001', '%CONFIRM_MISMATCH%');

-- F-19: 한쪽이 단독으로 실행할 수 있어야 한다 (상대 동의를 요구하면 영영 해제 불가).
select test.ok('F-20/F-21: 해제 성공 시 purge_after = dissolved_at + 30일',
  (with d as (select public.dissolve_couple('연결 해제') as r)
   select ((d.r ->> 'purge_after')::timestamptz - (d.r ->> 'dissolved_at')::timestamptz)
          = interval '30 days'
   from d));

select test.ok('F-21: 해제 즉시 접근이 끊긴다 (current_couple_id() = NULL)',
  public.current_couple_id() is null);

select test.as_user('00000000-0000-0000-0000-0000000000f7');
select test.ok('F-21: 상대도 함께 접근이 끊긴다',
  public.current_couple_id() is null);

select test.raises('F-19: 커플이 없으면 dissolve_couple 은 NOT_IN_COUPLE',
  $q$select public.dissolve_couple('연결 해제')$q$, 'P0001', '%NOT_IN_COUPLE%');

reset role;

select test.eq('F-20: 멤버십 행은 삭제된다',
  (select count(*)::text from public.couple_members), '0');

select test.eq('AC-13: couples 행 자체는 남는다 (30일 뒤 배치가 영구 삭제)',
  (select status from public.couples), 'dissolved');

select test.eq('해제 시 떠도는 초대 코드도 함께 무효화된다',
  (select count(*)::text from public.couple_invites
    where consumed_at is null and revoked_at is null), '0');
