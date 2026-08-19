-- ============================================================================
-- 기록 상한 조정 — 사진 5장→10장, 일기 2,000자→1,000자
--
-- 근거: 2026-08-15 사용자 결정 (docs/specs/00-data-model.md §9, 05-record-editor.md §9
-- 가 "임의값"으로 남겨뒀던 두 상수를 확정한다).
--
-- 이미 배포된 마이그레이션(20260811120300_records.sql, 20260812090000_upsert_record.sql)을
-- 고치지 않고 새 마이그레이션으로 얹는다 — 적용된 마이그레이션은 재작성하지 않는다는
-- 프로젝트 관례를 따른다.
-- ============================================================================

alter table public.records
  drop constraint records_note_length,
  add constraint records_note_length check (note is null or char_length(note) <= 1000);

alter table public.record_photos
  drop constraint record_photos_sort_order_range,
  add constraint record_photos_sort_order_range check (sort_order between 0 and 9);

-- upsert_record 의 c_max_note 도 같은 값이어야 한다 (DB CHECK보다 먼저 걸려서 봉투로
-- 응답해야 프론트가 NOTE_TOO_LONG 을 분기할 수 있다 — 원 함수 정의 상단 주석 참조).
-- 시그니처가 같은 create or replace 이므로 grant/revoke 를 다시 걸 필요는 없다.
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
  c_max_note    constant int := 1000;   -- 2026-08-15 결정 (records_note_length 제약과 같은 값)

  v_uid        uuid := (select auth.uid());
  v_couple_id  uuid := (select public.current_couple_id());
  v_mood       text;
  v_weather    text;
  v_note       text;
  v_tags       text[];
  v_record_id  uuid;
  v_created    boolean;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    perform public.app_raise('UNAUTHENTICATED', 'no authenticated user');
  end if;

  if v_couple_id is null then
    perform public.app_raise('NOT_IN_COUPLE', 'caller does not belong to an active couple');
  end if;

  if p_station_id is null
     or not exists (select 1 from public.stations s where s.id = p_station_id) then
    perform public.app_raise('STATION_NOT_FOUND', 'station does not exist');
  end if;

  if p_visited_on is null or p_visited_on > current_date + 1 then
    perform public.app_raise('INVALID_DATE', 'visited_on must not be in the future');
  end if;

  v_mood    := nullif(p_mood, '');
  v_weather := nullif(p_weather, '');

  if v_mood is not null and v_mood not in ('happy', 'love', 'excited', 'calm', 'sad') then
    perform public.app_raise('INVALID_ENUM', 'mood is not an allowed value');
  end if;

  if v_weather is not null and v_weather not in ('sunny', 'cloudy', 'rainy', 'snowy', 'windy') then
    perform public.app_raise('INVALID_ENUM', 'weather is not an allowed value');
  end if;

  if p_note is not null and char_length(p_note) > c_max_note then
    perform public.app_raise('NOTE_TOO_LONG', 'note exceeds 1000 characters');
  end if;

  v_note := case when btrim(coalesce(p_note, '')) = '' then null else p_note end;

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

  select array_agg(k.tag order by k.ord)
    into v_tags
  from (
    select distinct on (lower(i.tag)) i.tag, i.ord
    from (
      select public.normalize_tag(u.t) as tag, u.ord
      from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(t, ord)
    ) i
    where i.tag <> ''
    order by lower(i.tag), i.ord
  ) k;

  if p_record_id is null then
    insert into public.records
      (couple_id, station_id, visited_on, mood, weather, note, author_id)
    values
      (v_couple_id, p_station_id, p_visited_on, v_mood, v_weather, v_note, v_uid)
    returning id, updated_at into v_record_id, v_updated_at;

    v_created := true;
  else
    update public.records r
       set station_id = p_station_id,
           visited_on = p_visited_on,
           mood       = v_mood,
           weather    = v_weather,
           note       = v_note
     where r.id = p_record_id
       and r.couple_id = v_couple_id
    returning r.id, r.updated_at into v_record_id, v_updated_at;

    if v_record_id is null then
      perform public.app_raise('RECORD_NOT_FOUND', 'record not found');
    end if;

    v_created := false;
  end if;

  delete from public.record_tags t where t.record_id = v_record_id;

  if v_tags is not null then
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
