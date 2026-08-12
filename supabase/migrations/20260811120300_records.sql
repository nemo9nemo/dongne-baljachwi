-- ============================================================================
-- 데이트 기록: records / record_photos / record_tags
--
-- 근거: docs/specs/00-data-model.md §4.5~§4.7 (D-01, D-08, D-09)
--       docs/decisions/002-rls-only-authorization.md
--
-- record_photos / record_tags 는 부모를 조인하면 알 수 있는 couple_id 를 중복 보유한다.
-- 정규화를 의도적으로 포기한 것이다 — RLS 정책이 조인 없이 한 줄로 평가되게 하기 위해서다.
-- 대신 클라이언트가 보낸 couple_id 는 신뢰하지 않고 트리거가 부모 값으로 덮어쓴다.
-- 이 트리거가 빠지면 비정규화가 곧 데이터 불일치가 된다 (ADR-002 "포기한 것").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- records (00 §4.5)
-- ----------------------------------------------------------------------------

create table public.records (
  id             uuid        primary key default gen_random_uuid(),
  couple_id      uuid        not null references public.couples (id) on delete cascade,
  -- RESTRICT 인 이유: 역 마스터 재적재가 기록을 소리 없이 지우는 사고를 원천 차단한다.
  -- 폐역은 삭제가 아니라 stations.is_active=false 로 내린다 (00 AC-07).
  station_id     uuid        not null references public.stations (id) on delete restrict,
  -- D-08: 방문일은 "그날"이라는 사용자 의미가 있어 타임존 변환 대상이 아니다 → date.
  visited_on     date        not null,
  mood           text,
  weather        text,
  note           text,
  -- 최초 작성자. 변경 불가 (아래 트리거가 강제).
  author_id      uuid        not null references public.profiles (id),
  last_edited_by uuid        references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- 연애 시작 전 만남도 기록할 수 있어야 하므로 started_on 하한은 두지 않는다.
  -- 미래 방문만 막는다 (제약이 시간이 갈수록 느슨해지는 방향이라 기존 행은 항상 유효).
  --
  -- +1일인 이유는 couples_started_on_not_future 와 동일하다 (D-13): DB 는 UTC, 사용자는 KST 라
  -- KST 00:00~08:59 에 사용자가 고른 "오늘"은 서버 current_date 로는 내일이다. 여유를 주지 않으면
  -- 매일 새벽 9시간 동안 "오늘 다녀온 기록"이 거부된다. 정확한 상한은 클라이언트가 준다.
  constraint records_visited_on_not_future check (visited_on <= current_date + 1),
  -- D-09: enum 타입 대신 text + CHECK. 값 추가가 마이그레이션 1줄이다. NULL 허용 —
  -- PRD §5.2 의 목적이 "입력 마찰이 적은 것"이라 필수화하지 않는다.
  constraint records_mood_valid    check (mood    in ('happy', 'love', 'excited', 'calm', 'sad')),
  constraint records_weather_valid check (weather in ('sunny', 'cloudy', 'rainy', 'snowy', 'windy')),
  constraint records_note_length   check (note is null or char_length(note) <= 2000)
);

comment on table public.records is
  '데이트 기록. 커플의 공동 아카이브라 상대가 쓴 기록도 수정·삭제할 수 있다 (00 §4.5).';

create trigger records_set_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

-- 접근 패턴 1: 타임라인 키셋 페이지네이션 `where couple_id = ? and (visited_on, id) < (?, ?)`.
-- OFFSET 페이지네이션을 쓰지 않으므로 정렬 컬럼 순서까지 인덱스와 일치시켜야 한다.
create index records_timeline_idx on public.records (couple_id, visited_on desc, id desc);

-- 접근 패턴 2: 역 상세 화면과 방문 집계 뷰(couple_station_visits)의 GROUP BY 축.
create index records_couple_station_idx on public.records (couple_id, station_id);

-- 최초 작성자는 바뀌지 않는다. 커플 내부에서는 상대 기록도 수정 가능하므로,
-- "누가 썼고 누가 마지막에 고쳤는지"만이 유일한 구분 정보다 (00 §4.5).
create or replace function public.records_guard_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := old.author_id;
  new.couple_id := old.couple_id;   -- 다른 커플로 기록을 옮기는 경로를 원천 차단
  -- service_role 배치가 갱신하는 경우 auth.uid() 가 NULL 이므로 기존 값을 유지한다.
  new.last_edited_by := coalesce((select auth.uid()), old.last_edited_by);
  return new;
end;
$$;

create trigger records_guard_authorship
  before update on public.records
  for each row execute function public.records_guard_authorship();

-- ----------------------------------------------------------------------------
-- record_photos (00 §4.6)
-- ----------------------------------------------------------------------------

create table public.record_photos (
  id           uuid        primary key default gen_random_uuid(),
  record_id    uuid        not null references public.records (id) on delete cascade,
  couple_id    uuid        not null references public.couples (id) on delete cascade,
  -- {couple_id}/{record_id}/{photo_id}.{ext} — 첫 세그먼트가 Storage 정책의 격리 축이다.
  storage_path text        not null unique,
  sort_order   smallint    not null,
  -- 표시 시 레이아웃 시프트 방지용. 없으면 사진 로드 전후로 화면이 튄다.
  width        int         not null,
  height       int         not null,
  byte_size    int         not null,
  content_type text        not null,
  created_at   timestamptz not null default now(),

  -- 기록당 최대 5장(AC-10)을 카운트 트리거가 아니라 "0..4 범위 + UNIQUE"로 강제한다.
  -- 카운트 방식은 두 기기가 동시에 올리면 둘 다 4장을 보고 통과하는 경합이 있지만,
  -- 유니크 인덱스는 경합에서도 정확하다.
  constraint record_photos_sort_order_range check (sort_order between 0 and 4),
  constraint record_photos_sort_order_unique unique (record_id, sort_order),
  constraint record_photos_content_type_valid
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint record_photos_dimensions_positive check (width > 0 and height > 0 and byte_size > 0)
);

comment on table public.record_photos is
  '기록 사진 메타데이터. 원본은 비공개 Storage 버킷 record-photos 에 있다 (D-10).';

-- ----------------------------------------------------------------------------
-- record_tags (00 §4.7)
-- ----------------------------------------------------------------------------

create table public.record_tags (
  record_id  uuid        not null references public.records (id) on delete cascade,
  tag_norm   text        not null,   -- 정규화 + 소문자. 비교/집계 키
  couple_id  uuid        not null references public.couples (id) on delete cascade,
  tag        text        not null,   -- 사용자가 입력한 표기 (표시용)
  created_at timestamptz not null default now(),

  primary key (record_id, tag_norm),

  constraint record_tags_tag_length check (char_length(tag) between 1 and 20)
);

comment on table public.record_tags is
  '자유 태그. 태그 사전 테이블은 두지 않는다 — 사용자가 쓴 태그가 곧 필터 목록이다 (PRD §5.3).';

-- 접근 패턴: 타임라인 태그 필터(couple_id + tag_norm)와 couple_tag_usage 뷰의 GROUP BY 축.
create index record_tags_couple_tag_idx on public.record_tags (couple_id, tag_norm);

-- ----------------------------------------------------------------------------
-- couple_id 비정규화 채우기 (ADR-002)
-- ----------------------------------------------------------------------------

-- 클라이언트가 보낸 couple_id 를 쓰지 않고 부모 records 에서 복사한다.
-- SECURITY DEFINER 가 아니다(=RLS 적용) — 남의 기록 id 를 넣으면 SELECT 가 0행이 되어
-- 아래 예외로 떨어진다. 즉 이 트리거는 값 채우기 겸 소유권 검증이다.
create or replace function public.set_couple_id_from_record()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_couple_id uuid;
begin
  select r.couple_id into v_couple_id
  from public.records r
  where r.id = new.record_id;

  if v_couple_id is null then
    raise exception 'record % is not accessible', new.record_id
      using errcode = '42501';   -- insufficient_privilege: RLS 거부와 같은 코드로 통일
  end if;

  new.couple_id := v_couple_id;
  return new;
end;
$$;

create trigger record_photos_set_couple_id
  before insert on public.record_photos
  for each row execute function public.set_couple_id_from_record();

create trigger record_tags_set_couple_id
  before insert on public.record_tags
  for each row execute function public.set_couple_id_from_record();

-- 00 §4.7 의 태그 정규화 규칙은 프론트/백엔드 공통 계약이지만, 계약을 지키는 최종 책임은
-- DB가 진다. 클라이언트가 규칙을 어기면 "Cafe"와 "cafe"가 서로 다른 필터가 되어 조용히
-- 데이터가 갈라진다 — 화면 오류로 드러나지 않는 종류의 사고라 여기서 다시 계산한다.
create or replace function public.record_tags_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_max_tags constant int := 10;   -- 00 §4.7 규칙 6
  v_tag   text;
  v_count int;
begin
  -- 1) 유니코드 NFC  2) 앞뒤 공백 제거 + 내부 연속 공백 1칸  3) 선행 # 제거
  v_tag := normalize(coalesce(new.tag, ''), NFC);
  v_tag := btrim(regexp_replace(v_tag, '\s+', ' ', 'g'));
  v_tag := btrim(regexp_replace(v_tag, '^#+', ''));

  new.tag := v_tag;
  -- 4) 소문자 변환은 tag_norm 에만. 화면에는 사용자가 쓴 대로 보여주기 위해서다 (AC-09).
  new.tag_norm := lower(v_tag);

  select count(*) into v_count
  from public.record_tags t
  where t.record_id = new.record_id;

  -- 동시 삽입 경합에서 11개까지 들어갈 수 있다는 것을 알고 있다. 태그는 사진과 달리
  -- 순서 컬럼이 없어 유니크로 상한을 표현할 수 없고, 상한 초과의 피해가 경미하므로
  -- 잠금을 걸지 않는다 (의도적으로 처리하지 않는 실패 케이스).
  if v_count >= c_max_tags then
    raise exception 'record % already has % tags', new.record_id, c_max_tags
      using errcode = '23514';   -- check_violation
  end if;

  return new;
end;
$$;

create trigger record_tags_normalize
  before insert on public.record_tags
  for each row execute function public.record_tags_normalize();

-- ----------------------------------------------------------------------------
-- RLS — 모든 정책이 정확히 같은 표현식 하나만 쓴다 (D-03)
-- ----------------------------------------------------------------------------

alter table public.records       enable row level security;
alter table public.record_photos enable row level security;
alter table public.record_tags   enable row level security;

revoke all on public.records       from anon;
revoke all on public.record_photos from anon;
revoke all on public.record_tags   from anon;

revoke truncate on public.records, public.record_photos, public.record_tags from authenticated;

-- 명시적 권한 부여 (20260811120000_core_identity.sql 의 profiles 주석 참조).
-- 실제 행 범위는 아래 RLS 정책이 정한다. 여기서는 "어떤 동작이 가능한 종류인가"만 정의한다.
grant select, insert, update, delete on public.records       to authenticated;
grant select, insert, update, delete on public.record_photos to authenticated;
-- record_tags 는 UPDATE 를 주지 않는다 (수정 = 삭제 후 재삽입, 파일 끝 주석 참조).
grant select, insert, delete on public.record_tags to authenticated;

-- records: 커플 격리 + 작성자 위조 방지.
-- INSERT 에 author_id 조건을 더한 이유는 남의 이름으로 기록을 만드는 것을 막기 위해서다.
-- (수정·삭제는 커플 공동 권한이므로 author_id 조건을 걸지 않는다.)
create policy records_select on public.records
  for select to authenticated
  using (couple_id = (select public.current_couple_id()));

create policy records_insert on public.records
  for insert to authenticated
  with check (
    couple_id = (select public.current_couple_id())
    and author_id = (select auth.uid())
  );

create policy records_update on public.records
  for update to authenticated
  using (couple_id = (select public.current_couple_id()))
  with check (couple_id = (select public.current_couple_id()));

create policy records_delete on public.records
  for delete to authenticated
  using (couple_id = (select public.current_couple_id()));

-- record_photos / record_tags: couple_id 는 트리거가 채우므로, WITH CHECK 는
-- "트리거가 채운 값이 내 커플인가"를 확인하는 최종 관문이다 (BEFORE 트리거 → RLS 검사 순서).
create policy record_photos_select on public.record_photos
  for select to authenticated
  using (couple_id = (select public.current_couple_id()));

create policy record_photos_insert on public.record_photos
  for insert to authenticated
  with check (couple_id = (select public.current_couple_id()));

create policy record_photos_update on public.record_photos
  for update to authenticated
  using (couple_id = (select public.current_couple_id()))
  with check (couple_id = (select public.current_couple_id()));

create policy record_photos_delete on public.record_photos
  for delete to authenticated
  using (couple_id = (select public.current_couple_id()));

create policy record_tags_select on public.record_tags
  for select to authenticated
  using (couple_id = (select public.current_couple_id()));

create policy record_tags_insert on public.record_tags
  for insert to authenticated
  with check (couple_id = (select public.current_couple_id()));

create policy record_tags_delete on public.record_tags
  for delete to authenticated
  using (couple_id = (select public.current_couple_id()));

-- record_tags 는 UPDATE 정책을 두지 않는다. 태그 수정은 삭제 후 재삽입이며,
-- tag_norm 이 PK 라 UPDATE 로 바꿀 이유가 없다.
revoke update on public.record_tags from authenticated;
