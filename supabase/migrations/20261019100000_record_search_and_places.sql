-- D10–D11/D14: 기간·태그·역·본문·장소 검색과 월 집계가 같은 필터를 사용한다.
alter table public.records add column place_name text check (char_length(place_name) between 1 and 80);
create or replace view public.record_cards with (security_invoker=true) as
  select id, station_id, visited_on, mood, weather, left(note,200) as note_excerpt, author_id, place_name
  from public.records;

-- 기존 v2 재시도 계약은 유지한다. 장소를 편집하는 클라이언트는 v3를 사용한다.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.save_record_v2(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[])'::regprocedure);
  definition := replace(definition,'save_record_v2(','save_record_v3(');
  definition := replace(definition,'p_tags text[])','p_tags text[], p_place_name text DEFAULT NULL)');
  definition := replace(definition,'v_tags text[];', $body$v_tags text[];
  v_place text := nullif(btrim(p_place_name),'');$body$);
  definition := replace(definition,'if v_uid is null then', $body$if char_length(v_place)>80 then perform public.app_raise('INVALID_PLACE','place exceeds 80 characters'); end if;
  if v_place is not null then v_request := v_request || jsonb_build_array(v_place); end if;
  if v_uid is null then$body$);
  definition := replace(definition,'note, author_id)', 'note, author_id, place_name)');
  definition := replace(definition,'end, v_uid) returning', 'end, v_uid, v_place) returning');
  definition := replace(definition,'update public.records set station_id = p_station_id,', 'update public.records set place_name = v_place, station_id = p_station_id,');
  execute definition;
end;
$$;
revoke all on function public.save_record_v3(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[],text) from public,anon;
grant execute on function public.save_record_v3(uuid,uuid,boolean,integer,uuid,date,text,text,text,text[],text) to authenticated;

create function public.filtered_records(
  p_query text default null, p_station_id uuid default null, p_tag_norm text default null,
  p_start date default null, p_end date default null
) returns setof public.records language sql stable security invoker set search_path='' as $$
  select r.* from public.records r
  where (p_station_id is null or r.station_id=p_station_id)
    and (p_start is null or r.visited_on>=p_start) and (p_end is null or r.visited_on<=p_end)
    and (nullif(btrim(p_tag_norm),'') is null or exists(select 1 from public.record_tags t where t.record_id=r.id and t.tag_norm=p_tag_norm))
    -- %, _를 특수 문법으로 해석하지 않고 그대로 부분 문자열로 검색한다.
    and (nullif(btrim(p_query),'') is null or strpos(lower(coalesce(r.note,'')||' '||coalesce(r.place_name,'')),lower(btrim(p_query)))>0
      or exists(select 1 from public.station_master_public s where s.id=r.station_id and strpos(lower(s.name),lower(btrim(p_query)))>0));
$$;
revoke all on function public.filtered_records(text,uuid,text,date,date) from public,anon;
grant execute on function public.filtered_records(text,uuid,text,date,date) to authenticated;

create function public.query_record_cards(
  p_query text default null, p_station_id uuid default null, p_tag_norm text default null,
  p_start date default null, p_end date default null,
  p_cursor_date date default null, p_cursor_id uuid default null, p_jump date default null,
  p_limit integer default 21
) returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(page) order by page.visited_on desc,page.id desc),'[]'::jsonb) from (
    select r.id,r.station_id,r.visited_on,r.mood,r.weather,left(r.note,200) as note_excerpt,r.author_id,r.place_name
    from public.filtered_records(p_query,p_station_id,p_tag_norm,p_start,p_end) r
    where (p_jump is null or r.visited_on<=p_jump)
      and (p_cursor_date is null or (r.visited_on,r.id)<(p_cursor_date,p_cursor_id))
    order by r.visited_on desc,r.id desc limit greatest(1,least(coalesce(p_limit,21),101))
  ) page;
$$;
create function public.query_record_months(
  p_query text default null, p_station_id uuid default null, p_tag_norm text default null,
  p_start date default null, p_end date default null
) returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(months) order by months.month desc),'[]'::jsonb) from (
    select to_char(r.visited_on,'YYYY-MM') as month,count(*)::int as count
    from public.filtered_records(p_query,p_station_id,p_tag_norm,p_start,p_end) r group by 1
  ) months;
$$;
revoke all on function public.query_record_cards(text,uuid,text,date,date,date,uuid,date,integer),
  public.query_record_months(text,uuid,text,date,date) from public,anon;
grant execute on function public.query_record_cards(text,uuid,text,date,date,date,uuid,date,integer),
  public.query_record_months(text,uuid,text,date,date) to authenticated;
