-- ============================================================================
-- upsert_record() — 기록 본문 + 태그 저장의 유일한 경로
--
-- 근거: docs/specs/05-record-editor.md §4.2 (F-30/F-31/F-34), AC-02/AC-05/AC-06/AC-07/AC-12/AC-17
--       docs/specs/00-data-model.md §4.7 (태그 정규화 규칙)
--
-- 왜 함수인가 (05 §4.2): 태그는 별도 테이블이고 수정 시 "전 행 삭제 후 재삽입"이 필요하다.
-- 이걸 클라이언트가 2회 요청으로 쪼개면 중간 실패 시 **태그가 사라진 기록**이 남는다.
-- 함수 호출 1회 = 트랜잭션 1회이므로 본문과 태그는 함께 커밋되거나 함께 롤백된다 (F-34).
--
-- 사진은 여기 넣지 않는다 (05 §4.3). 업로드는 수 초가 걸려 트랜잭션에 넣을 수 없고,
-- F-16 이 "사진 실패가 기록 저장을 막지 않는다"를 요구하므로 애초에 경계가 달라야 한다.
--
-- 에러 전달 경로는 (A) — app_raise 로 던진다 (20260811120100_couple_link.sql 상단 주석).
-- redeem_invite 처럼 실패를 커밋해야 할 사정(rate limit 카운터)이 없으므로 예외가 맞다.
-- 오히려 예외라야 "본문은 저장됐는데 태그 검증에서 실패" 같은 반쪽 상태가 원천적으로 없다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 태그 정규화 (00 §4.7) — 규칙의 단일 출처
-- ----------------------------------------------------------------------------

-- 이 규칙은 프론트/백엔드 공통 계약이라 DB 안에서까지 두 벌로 존재하면 반드시 갈라진다.
-- (기존에는 record_tags_normalize 트리거 안에만 있었는데, upsert_record 가 "중복 제거"와
--  "길이 검증"을 하려면 삽입 전에 같은 계산이 필요하다 — 그래서 함수로 뽑아 둘이 공유한다.)
create or replace function public.normalize_tag(p_tag text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- 1) 유니코드 NFC  2) 앞뒤 공백 제거 + 내부 연속 공백 1칸  3) 선행 # 제거
  select btrim(regexp_replace(
           btrim(regexp_replace(normalize(coalesce(p_tag, ''), NFC), '\s+', ' ', 'g')),
           '^#+', ''
         ));
$$;

comment on function public.normalize_tag(text) is
  '태그 정규화 규칙 (00 §4.7 1~3). tag_norm 은 여기에 lower() 를 한 번 더 적용한 값이다.';

revoke all on function public.normalize_tag(text) from public, anon;
-- 트리거 record_tags_normalize 는 SECURITY INVOKER 라, 클라이언트가 record_tags 에 직접
-- INSERT 할 때 authenticated 권한으로 이 함수를 호출한다. 권한을 주지 않으면 그 경로가 깨진다.
grant execute on function public.normalize_tag(text) to authenticated;

-- 기존 트리거를 위 함수에 위임하도록 교체한다. 동작은 그대로다 (같은 식을 옮겼을 뿐).
create or replace function public.record_tags_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_max_tags constant int := 10;   -- 00 §4.7 규칙 6
  v_count int;
begin
  new.tag := public.normalize_tag(new.tag);
  -- 4) 소문자 변환은 tag_norm 에만. 화면에는 사용자가 쓴 대로 보여주기 위해서다 (AC-09).
  new.tag_norm := lower(new.tag);

  select count(*) into v_count
  from public.record_tags t
  where t.record_id = new.record_id;

  -- 동시 삽입 경합에서 11개까지 들어갈 수 있다는 것을 알고 있다. 태그는 사진과 달리
  -- 순서 컬럼이 없어 유니크로 상한을 표현할 수 없고, 상한 초과의 피해가 경미하므로
  -- 잠금을 걸지 않는다 (의도적으로 처리하지 않는 실패 케이스).
  --
  -- ⚠ 이 검사는 **행 단위**라 "요청 전체가 몇 개인가"를 알 수 없다. upsert_record 는
  -- 삽입 전에 총 개수를 직접 세어 INVALID_TAGS 로 거부한다 — 여기 걸리면 봉투가 아닌
  -- 원시 23514 가 프론트로 새어 나가기 때문이다. 이 트리거는 직접 INSERT 경로용 방어선이다.
  if v_count >= c_max_tags then
    raise exception 'record % already has % tags', new.record_id, c_max_tags
      using errcode = '23514';   -- check_violation
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- upsert_record (05 §4.2)
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER 인 이유는 두 가지다.
--   1) app_raise / app_error 는 authenticated 에게 실행 권한이 없다(그래야 PostgREST 가
--      에러 생성기를 RPC 로 노출하지 않는다). 봉투 형식을 쓰려면 definer 여야 한다.
--   2) 이 함수는 검증을 스스로 전부 하므로 RLS 재평가가 이득이 없다.
-- 대신 definer 는 RLS 를 우회하므로 **커플 격리는 아래 세 지점이 전부 책임진다**:
--   - INSERT 의 couple_id 는 항상 current_couple_id() (클라이언트 값을 받지 않는다)
--   - UPDATE 는 `where id = ? and couple_id = v_couple_id` (0행이면 RECORD_NOT_FOUND)
--   - 태그 삭제/삽입은 위에서 소유권이 확인된 v_record_id 로만 한다
-- 이 셋 중 하나라도 무너지면 커플 A 가 커플 B 의 기록을 덮어쓸 수 있다. 수정 시 주의.
create or replace function public.upsert_record(
  p_record_id  uuid,
  p_station_id uuid,
  p_visited_on date,
  p_mood       text   default null,
  p_weather    text   default null,
  p_note       text   default null,
  p_tags       text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_tags    constant int := 10;     -- 00 §4.7 규칙 6
  c_max_tag_len constant int := 20;     -- 00 §4.7 규칙 5
  c_max_note    constant int := 2000;   -- F-24 (records_note_length 제약과 같은 값)

  v_uid        uuid := (select auth.uid());
  v_couple_id  uuid := (select public.current_couple_id());
  v_mood       text;
  v_weather    text;
  v_note       text;
  v_tags       text[];   -- 정규화 + 중복 제거된 표시용 태그 (입력 순서 유지)
  v_record_id  uuid;
  v_created    boolean;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    perform public.app_raise('UNAUTHENTICATED', 'no authenticated user');
  end if;

  -- 05 §2.3: 커플 미연결 사용자는 이 화면에 도달하지 않는다. 그래도 서버가 다시 막는다.
  if v_couple_id is null then
    perform public.app_raise('NOT_IN_COUPLE', 'caller does not belong to an active couple');
  end if;

  -- 역 존재 확인. is_active 는 보지 않는다 — 폐역이 된 뒤에도 그 역의 기록을 수정할 수
  -- 있어야 한다 (F-10 "이미 선택된 기록의 역은 유지").
  if p_station_id is null
     or not exists (select 1 from public.stations s where s.id = p_station_id) then
    perform public.app_raise('STATION_NOT_FOUND', 'station does not exist');
  end if;

  -- 상한이 current_date 가 아니라 +1 인 이유는 records_visited_on_not_future 제약과 같다(D-13):
  -- 서버는 UTC, 사용자는 KST 라 KST 00:00~08:59 에는 사용자의 "오늘"이 서버 기준 내일이다.
  -- 여기서 제약보다 빡빡하게 잡으면 매일 새벽 9시간 동안 "오늘 다녀온 기록"이 거부된다.
  -- 진짜 "미래 금지"(F/AC-04)는 클라이언트 날짜 선택기가 로컬 기준으로 막는다.
  if p_visited_on is null or p_visited_on > current_date + 1 then
    perform public.app_raise('INVALID_DATE', 'visited_on must not be in the future');
  end if;

  -- 빈 문자열은 "선택 안 함"으로 본다. 그대로 넘기면 CHECK 위반(23514)이 원시 에러로
  -- 새어 나가 프론트가 error_code 로 분기할 수 없다 (F-13 해제 동작이 '' 로 올 수도 있다).
  v_mood    := nullif(p_mood, '');
  v_weather := nullif(p_weather, '');

  -- F-11/F-14: 저장 값은 이모지가 아니라 영문 슬러그. 목록은 records_mood_valid /
  -- records_weather_valid CHECK 와 **반드시 같이 움직여야 한다** (07 확장 포인트).
  if v_mood is not null and v_mood not in ('happy', 'love', 'excited', 'calm', 'sad') then
    perform public.app_raise('INVALID_ENUM', 'mood is not an allowed value');
  end if;

  if v_weather is not null and v_weather not in ('sunny', 'cloudy', 'rainy', 'snowy', 'windy') then
    perform public.app_raise('INVALID_ENUM', 'weather is not an allowed value');
  end if;

  if p_note is not null and char_length(p_note) > c_max_note then
    perform public.app_raise('NOTE_TOO_LONG', 'note exceeds 2000 characters');
  end if;

  -- 공백만 남은 일기는 NULL 로 눕힌다("일기 없음"과 같은 상태여야 한다).
  -- 내용이 있으면 원문 그대로 저장한다 — 사용자가 의도한 줄바꿈·들여쓰기를 서버가 손대지 않는다.
  v_note := case when btrim(coalesce(p_note, '')) = '' then null else p_note end;

  -- 태그 개수는 **정규화 전 원본 배열 기준**으로 먼저 막는다. 이유가 둘이다:
  --  (1) 05 §4.2 의 "tags: 최대 10개"를 글자 그대로 적용한 것이고,
  --  (2) 아래 정규화·중복 제거가 임의 길이 배열에 대해 돌아가는 것을 막는 비용 상한이다.
  if coalesce(array_length(p_tags, 1), 0) > c_max_tags then
    perform public.app_raise('INVALID_TAGS', 'too many tags');
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_tags, '{}'::text[])) as t
    where char_length(public.normalize_tag(t)) > c_max_tag_len
  ) then
    perform public.app_raise('INVALID_TAGS', 'a tag exceeds 20 characters');
  end if;

  -- 00 §4.7 규칙 6: 같은 기록 내 tag_norm 중복은 **조용히 무시**(에러 아님).
  -- 정규화 결과가 빈 문자열인 것("#", 공백만)도 조용히 버린다 — 정보가 없는 입력 하나 때문에
  -- 사용자의 일기 저장 전체를 실패시키는 건 F-05(입력값 보존)의 취지에 어긋난다.
  select array_agg(k.tag order by k.ord)
    into v_tags
  from (
    select distinct on (lower(i.tag)) i.tag, i.ord
    from (
      select public.normalize_tag(u.t) as tag, u.ord
      from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(t, ord)
    ) i
    where i.tag <> ''
    order by lower(i.tag), i.ord   -- 중복이면 먼저 입력한 표기를 남긴다
  ) k;

  if p_record_id is null then
    -- 신규. couple_id/author_id 는 클라이언트가 보낸 값을 쓰지 않는다 (05 §4.4).
    insert into public.records
      (couple_id, station_id, visited_on, mood, weather, note, author_id)
    values
      (v_couple_id, p_station_id, p_visited_on, v_mood, v_weather, v_note, v_uid)
    returning id, updated_at into v_record_id, v_updated_at;

    v_created := true;
  else
    -- 수정. author_id 는 건드리지 않는다 (F-30) — 넘겨도 records_guard_authorship 이 되돌린다.
    -- last_edited_by(F-31)도 같은 트리거가 auth.uid() 로 채우므로 여기서 대입하지 않는다.
    update public.records r
       set station_id = p_station_id,
           visited_on = p_visited_on,
           mood       = v_mood,
           weather    = v_weather,
           note       = v_note
     where r.id = p_record_id
       and r.couple_id = v_couple_id
    returning r.id, r.updated_at into v_record_id, v_updated_at;

    -- AC-17: 남의 기록인지 삭제된 기록인지 구분하지 않는다. 구분하면 다른 커플의 record_id
    -- 존재 여부를 알려주는 열거 채널이 된다.
    if v_record_id is null then
      perform public.app_raise('RECORD_NOT_FOUND', 'record not found');
    end if;

    v_created := false;
  end if;

  -- 전 행 삭제 후 재삽입 (05 §4.2). 차집합 계산으로 최소 변경만 하는 방법도 있지만,
  -- 기록당 태그는 10개 이하라 이득이 없고 "화면에 보이는 목록 = 저장된 목록"이 자명해진다.
  -- 같은 트랜잭션이라 태그가 빈 순간이 다른 세션에 보이지 않는다.
  delete from public.record_tags t where t.record_id = v_record_id;

  if v_tags is not null then
    -- tag_norm 은 트리거가 어차피 다시 계산한다(위 record_tags_normalize). 여기서도 채우는 건
    -- NOT NULL 컬럼이기 때문이며, 같은 normalize_tag 를 쓰므로 두 값이 어긋날 수 없다.
    insert into public.record_tags (record_id, couple_id, tag, tag_norm)
    select v_record_id, v_couple_id, t, lower(t)
    from unnest(v_tags) as t;
  end if;

  return json_build_object(
    'record_id',  v_record_id,
    'created',    v_created,
    'updated_at', v_updated_at
  )::jsonb;
end;
$$;

comment on function public.upsert_record(uuid, uuid, date, text, text, text, text[]) is
  '기록 본문 + 태그를 한 트랜잭션으로 저장한다 (05 §4.2, F-34). 사진은 포함하지 않는다 (05 §4.3).';

revoke all on function public.upsert_record(uuid, uuid, date, text, text, text, text[])
  from public, anon;
grant execute on function public.upsert_record(uuid, uuid, date, text, text, text, text[])
  to authenticated;
