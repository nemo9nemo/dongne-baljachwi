-- D06/D10/D11/D14: 개인 공간 격리와 대용량 키셋 조회를 실제 RLS 아래에서 검사한다.
select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000a1','personal-a@test.invalid');
select test.signup('00000000-0000-0000-0000-0000000000b1','personal-b@test.invalid');
select test.seed_station('PERSONAL','개인역');
select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select set_config('test.personal',public.get_record_context()->>'personal_id',false);
select test.eq('개인 공간 생성 재시도 동일',public.get_record_context()->>'personal_id',current_setting('test.personal'));
select test.eq('개인 공간은 커플 멤버십을 만들지 않음',(select count(*)::text from public.couple_members),'0');
select set_config('request.headers',jsonb_build_object('x-record-scope',current_setting('test.personal'))::text,false);
select test.eq('헤더의 개인 범위 검증',public.current_record_scope()::text,current_setting('test.personal'));
select test.ok('상대 연결 없이 장소 포함 기록 작성',public.save_record_v3(
  '00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000001002',true,null,
  (select id from public.station_master_public where code='PERSONAL'),current_date,null,null,'100% literal_test',array['산책'],'  카페 A  ')->>'record_id' is not null);
select test.eq('장소 공백 정규화',(select place_name from public.records),'카페 A');
select test.eq('장소 검색',jsonb_array_length(public.query_record_cards(p_query=>'카페 A'))::text,'1');
select test.eq('역명 검색',jsonb_array_length(public.query_record_cards(p_query=>'개인역'))::text,'1');
select test.eq('퍼센트를 와일드카드로 해석하지 않음',jsonb_array_length(public.query_record_cards(p_query=>'100%'))::text,'1');
select test.eq('언더스코어를 와일드카드로 해석하지 않음',jsonb_array_length(public.query_record_cards(p_query=>'literalXtest'))::text,'0');
select test.eq('태그 정확 일치',jsonb_array_length(public.query_record_cards(p_tag_norm=>'산'))::text,'0');
select test.eq('월 집계와 목록 조건 일치',public.query_record_months(p_tag_norm=>'산책')->0->>'count','1');
select test.raises('장소 81자 거부',format($q$select public.save_record_v3(
  '00000000-0000-0000-0000-000000001011','00000000-0000-0000-0000-000000001012',true,null,
  (select id from public.station_master_public where code='PERSONAL'),current_date,null,null,null,'{}',%L)$q$,repeat('가',81)), 'P0001','%INVALID_PLACE%');
reset role;
insert into public.records(id,couple_id,station_id,visited_on,note,author_id)
  select md5('bulk-'||n)::uuid,current_setting('test.personal')::uuid,(select id from public.stations where code='PERSONAL'),
    current_date,repeat('가',250),'00000000-0000-0000-0000-0000000000a1' from generate_series(1,1050) n;
insert into public.record_tags(record_id,couple_id,tag,tag_norm)
  select id,couple_id,'대량','대량' from public.records where note=repeat('가',250);
set role authenticated;
do $$
declare page jsonb; last_row jsonb; cursor_date date; cursor_id uuid; seen uuid[] := '{}'; row jsonb; all_unique boolean:=true; bounded boolean:=true;
begin
  loop
    page := public.query_record_cards(p_tag_norm=>'대량',p_cursor_date=>cursor_date,p_cursor_id=>cursor_id,p_limit=>100);
    exit when jsonb_array_length(page)=0;
    for row in select * from jsonb_array_elements(page) loop
      all_unique := all_unique and not (row->>'id')::uuid=any(seen);
      seen:=array_append(seen,(row->>'id')::uuid);
      bounded := bounded and char_length(row->>'note_excerpt')=200;
    end loop;
    last_row := page->(jsonb_array_length(page)-1);
    cursor_date:=(last_row->>'visited_on')::date; cursor_id:=(last_row->>'id')::uuid;
  end loop;
  perform test.eq('같은 날짜·태그 1050건 누락 없음',cardinality(seen)::text,'1050');
  perform test.ok('모든 페이지에서 중복 없음',all_unique);
  perform test.ok('모든 페이지에서 일기 200자 상한',bounded);
end;
$$;
select test.eq('월 집계 1050건',public.query_record_months(p_tag_norm=>'대량')->0->>'count','1050');
select test.eq('날짜 상한 이전 점프',jsonb_array_length(public.query_record_cards(p_jump=>current_date-1))::text,'0');
reset role;
insert into public.couples(id,started_on,created_by) values('00000000-0000-0000-0000-0000000000ee',current_date,'00000000-0000-0000-0000-0000000000a1');
insert into public.couple_members(couple_id,user_id,role) values
 ('00000000-0000-0000-0000-0000000000ee','00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000ee','00000000-0000-0000-0000-0000000000b1','partner');
insert into public.records(id,couple_id,station_id,visited_on,note,author_id)
 select '00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-0000000000ee',id,current_date,'기존 공동 기록','00000000-0000-0000-0000-0000000000a1' from public.stations where code='PERSONAL';
set role authenticated;
select test.eq('기존 공동 연결 후에도 개인 기록 수 보존',jsonb_array_length(public.query_record_cards(p_query=>'기존 공동 기록'))::text,'0');
select test.eq('개인 공간을 만들어도 기존 공동 ID 보존',public.get_record_context()->>'shared_id','00000000-0000-0000-0000-0000000000ee');
select set_config('request.headers','{"x-record-scope":"00000000-0000-0000-0000-0000000000ee"}',false);
select test.eq('명시적 공동 공간 선택 시 공동 기록만 조회',jsonb_array_length(public.query_record_cards())::text,'1');
select test.eq('개인 기록은 공동 범위에 비노출',public.query_record_cards(p_query=>'카페 A')::text,'[]');
select set_config('request.headers',jsonb_build_object('x-record-scope',current_setting('test.personal'))::text,false);
select test.as_user('00000000-0000-0000-0000-0000000000b1');
select test.eq('타 계정 개인 공간 헤더 거부',public.current_record_scope()::text,null);
select test.eq('타 계정 목록 비노출',public.query_record_cards()::text,'[]');
select test.eq('타 계정 월 건수 비노출',public.query_record_months()::text,'[]');
select test.eq('타 계정 편집 스냅샷 비노출',public.get_record_edit_snapshot('00000000-0000-0000-0000-000000001001')::text,null);
select test.raises('공동 파트너도 상대 개인 사진 업로드 불가',format($q$insert into storage.objects(bucket_id,name) values('record-photos',%L)$q$,current_setting('test.personal')||'/record/photo.jpg'),'42501');
select set_config('request.headers','{"x-record-scope":"invalid"}',false);
select test.eq('잘못된 범위 헤더는 기본 범위로 폴백하지 않음',public.current_record_scope()::text,null);
select set_config('request.headers','{}',false);
reset role;
