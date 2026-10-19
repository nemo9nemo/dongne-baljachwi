-- D01–D04: 실제 전환 마이그레이션 이후의 권한, 원자성, 버전, 재시도 계약.
select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000a1','write-a@test.invalid');
select test.signup('00000000-0000-0000-0000-0000000000a2','write-partner@test.invalid');
select test.signup('00000000-0000-0000-0000-0000000000b1','write-b@test.invalid');
insert into public.couples(id,started_on,created_by) values
 ('00000000-0000-0000-0000-0000000000aa',current_date,'00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000000bb',current_date,'00000000-0000-0000-0000-0000000000b1');
insert into public.couple_members(couple_id,user_id,role) values
 ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000a2','partner'),
 ('00000000-0000-0000-0000-0000000000bb','00000000-0000-0000-0000-0000000000b1','owner');
select test.seed_station('WRITE','저장역');
insert into public.records(id,couple_id,station_id,visited_on,author_id)
 select '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-0000000000bb',id,current_date,'00000000-0000-0000-0000-0000000000b1'
 from public.stations where code='WRITE';
insert into public.record_photos(id,record_id,couple_id,storage_path,sort_order,width,height,byte_size,content_type)
 values('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-0000000000bb',
 '00000000-0000-0000-0000-0000000000bb/00000000-0000-0000-0000-000000000012/00000000-0000-0000-0000-000000000901.jpg',0,20,20,100,'image/jpeg');
create function test.write_body(p_op integer, p_create boolean, p_revision integer,
  p_note text default '원본', p_tags text[] default array['#산책','산책','카페']) returns jsonb
language sql as $$
  select public.save_record_v2('00000000-0000-0000-0000-000000000011',
    ('00000000-0000-0000-0000-' || lpad(p_op::text,12,'0'))::uuid,p_create,p_revision,
    (select id from public.stations where code='WRITE'),current_date,'happy','sunny',p_note,p_tags);
$$;
create function test.photo(p_id integer, p_order integer) returns jsonb language sql as $$
  select jsonb_build_object('id', '00000000-0000-0000-0000-'||lpad(p_id::text,12,'0'),
    'storage_path', '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-000000000011/00000000-0000-0000-0000-'||lpad(p_id::text,12,'0')||'.jpg',
    'sort_order',p_order,'width',20,'height',20,'byte_size',100,'content_type','image/jpeg');
$$;
create function test.write_photos(p_op integer,p_revision integer,p_list jsonb) returns jsonb language sql as $$
  select public.sync_record_photos('00000000-0000-0000-0000-000000000011',
    ('00000000-0000-0000-0000-'||lpad(p_op::text,12,'0'))::uuid,p_revision,p_list);
$$;
grant execute on all functions in schema test to authenticated,anon;
select test.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select set_config('test.first',test.write_body(101,true,null)::text,false);
select test.eq('신규 ID와 버전 1',current_setting('test.first')::jsonb->>'revision','1');
select test.eq('스냅샷에 태그 정규화·중복 제거',
  (public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011')->'tags')::text,'["산책", "카페"]');
select test.eq('스냅샷의 빈 사진 목록',
  (public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011')->'photos')::text,'[]');
select test.eq('같은 신규 요청 재전송 결과 동일',test.write_body(101,true,null)::text,current_setting('test.first')::jsonb::text);
select test.eq('같은 신규 요청의 기록 수 1',(select count(*)::text from public.records),'1');
select test.raises('같은 작업 ID로 다른 본문 거부',$q$select test.write_body(101,true,null,'다른 요청')$q$,'P0001','%OPERATION_MISMATCH%');
select test.raises('새 작업으로 생성 ID 재사용 거부',$q$select test.write_body(102,true,null)$q$,'P0001','%RECORD_ID_USED%');
select test.eq('본문 수정은 버전 2',test.write_body(103,false,1,'수정')->>'revision','2');
select test.raises('같은 기준 버전의 두 번째 본문 거부',$q$select test.write_body(104,false,1,'오래된 수정')$q$,'P0001','%RECORD_CONFLICT%');
select test.eq('충돌이 최신 본문 보존',(select note from public.records),'수정');
select test.eq('수정 이후에도 최초 영수증 반환',test.write_body(101,true,null)::text,current_setting('test.first')::jsonb::text);
select test.raises('일기 1001자 거부',$q$select test.write_body(105,false,2,repeat('😀',1001))$q$,'P0001','%NOTE_TOO_LONG%');
select test.raises('태그 11개 거부',$q$select test.write_body(106,false,2,'',array_fill('태그'::text,array[11]))$q$,'P0001','%INVALID_TAGS%');
select test.eq('검증 실패의 버전 롤백',(select revision::text from public.records),'2');
select test.raises('레거시 RPC 차단',$q$select public.upsert_record(null,null,null)$q$,'42501');
select test.raises('직접 본문 UPDATE 차단',$q$update public.records set note='우회'$q$,'42501');
select test.raises('직접 본문 INSERT 차단',$q$insert into public.records default values$q$,'42501');
select test.raises('직접 태그 DELETE 차단',$q$delete from public.record_tags$q$,'42501');
select test.raises('직접 사진 DELETE 차단',$q$delete from public.record_photos$q$,'42501');
select test.raises('직접 사진 INSERT 차단',$q$insert into public.record_photos default values$q$,'42501');
select test.raises('영수증 직접 열람 차단',$q$select * from public.record_write_receipts$q$,'42501');
insert into storage.objects(bucket_id,name) select 'record-photos',test.photo(n,n-201)->>'storage_path' from generate_series(201,204) n;
insert into storage.objects(bucket_id,name) values ('record-photos',test.photo(901,0)->>'storage_path');
select test.raises('오래된 본문 버전으로 사진 변경 거부',
 $q$select test.write_photos(301,1,jsonb_build_array(test.photo(201,0)))$q$,'P0001','%RECORD_CONFLICT%');
select set_config('test.photos',test.write_photos(302,2,jsonb_build_array(test.photo(201,0),test.photo(202,1),test.photo(203,2)))::text,false);
select test.eq('사진 목록 확정 버전 3',current_setting('test.photos')::jsonb->>'revision','3');
select test.eq('세 장 모두 확정',(select count(*)::text from public.record_photos),'3');
select test.eq('같은 사진 요청 반복은 동일 결과',test.write_photos(302,2,jsonb_build_array(test.photo(201,0),test.photo(202,1),test.photo(203,2)))::text,current_setting('test.photos')::jsonb::text);
select test.raises('사진 이후 오래된 본문 거부',$q$select test.write_body(107,false,2,'본문 덮기')$q$,'P0001','%RECORD_CONFLICT%');
select test.raises('사진 대 사진 버전 충돌',$q$select test.write_photos(303,2,'[]')$q$,'P0001','%RECORD_CONFLICT%');
select test.raises('같은 사진 ID로 요청 내용 변경 거부',$q$select test.write_photos(302,2,'[]')$q$,'P0001','%OPERATION_MISMATCH%');
select test.raises('사진 ID 중복 거부',$q$select test.write_photos(304,3,jsonb_build_array(test.photo(201,0),test.photo(201,1)))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 순서와 배열 불일치 거부',$q$select test.write_photos(305,3,jsonb_build_array(test.photo(201,1)))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 11장 거부',$q$select test.write_photos(306,3,(select jsonb_agg(test.photo(n,n-201)) from generate_series(201,211)n))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 잘못된 UUID 거부',$q$select test.write_photos(307,3,jsonb_build_array(test.photo(201,0)||'{"id":"잘못됨"}'))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 치수 상한 거부',$q$select test.write_photos(308,3,jsonb_build_array(test.photo(201,0)||'{"width":2049}'))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 용량 상한 거부',$q$select test.write_photos(309,3,jsonb_build_array(test.photo(201,0)||'{"byte_size":10485761}'))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('사진 타입 거부',$q$select test.write_photos(310,3,jsonb_build_array(test.photo(201,0)||'{"content_type":"text/plain"}'))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('업로드 없는 사진 거부',$q$select test.write_photos(311,3,jsonb_build_array(test.photo(205,0)))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('다른 기록 경로 거부',$q$select test.write_photos(312,3,jsonb_build_array(test.photo(201,0)||'{"storage_path":"00000000-0000-0000-0000-0000000000aa/other/photo.jpg"}'))$q$,'P0001','%INVALID_PHOTOS%');
select test.raises('업로드가 존재해도 다른 기록 사진 ID 재사용 거부',$q$select test.write_photos(319,3,jsonb_build_array(test.photo(901,0)))$q$,'P0001','%INVALID_PHOTOS%');
select test.eq('잘못된 사진 요청이 기존 목록 보존',(select count(*)::text from public.record_photos),'3');
with gone as (delete from storage.objects where name=test.photo(201,0)->>'storage_path' returning 1)
 select test.eq('참조 중 파일 직접 삭제 차단',(select count(*)::text from gone),'0');
with changed as (update storage.objects set owner=auth.uid() where name=test.photo(201,0)->>'storage_path' returning 1)
 select test.eq('참조 중 파일 덮어쓰기 차단',(select count(*)::text from changed),'0');
reset role;
create function test.fail_photo_insert() returns trigger language plpgsql as $$
begin if new.sort_order=1 then raise exception 'injected insert failure' using errcode='23514'; end if; return new; end; $$;
create trigger test_photo_failure before insert on public.record_photos for each row execute function test.fail_photo_insert();
set role authenticated;
select test.raises('순서 교체 INSERT 오류 주입',
 $q$select test.write_photos(313,3,jsonb_build_array(test.photo(203,0),test.photo(202,1),test.photo(201,2)))$q$,'23514');
select test.eq('DELETE까지 롤백되어 세 장 보존',(select count(*)::text from public.record_photos),'3');
select test.eq('INSERT 실패 후 원래 순서 보존',(select sort_order::text from public.record_photos where id='00000000-0000-0000-0000-000000000201'),'0');
select test.eq('INSERT 실패 후 버전 보존',(select revision::text from public.records),'3');
reset role;
drop trigger test_photo_failure on public.record_photos;
set role authenticated;
select test.eq('같은 실패 작업 재시도 성공',test.write_photos(313,3,jsonb_build_array(test.photo(203,0),test.photo(202,1),test.photo(201,2)))->>'revision','4');
select test.eq('순서 교체 완료',(select sort_order::text from public.record_photos where id='00000000-0000-0000-0000-000000000201'),'2');
select test.ok('사진 제거 경로가 성공 결과에 포함',test.write_photos(314,4,jsonb_build_array(test.photo(203,0)))->'removed_paths' @> jsonb_build_array(test.photo(201,0)->>'storage_path'));
with gone as (delete from storage.objects where name=test.photo(201,0)->>'storage_path' returning 1)
 select test.eq('목록 제거 후 파일 정리 허용',(select count(*)::text from gone),'1');
select test.as_user('00000000-0000-0000-0000-0000000000a2');
select test.eq('공동 공간 상대도 최신 스냅샷 조회',(public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011')->'record'->>'revision'),'5');
select test.eq('다른 호출자는 같은 operation ID를 독립 사용',test.write_body(101,false,5,'상대 수정')->>'revision','6');
select test.eq('상대 수정도 최초 작성자 보존',(select author_id::text from public.records where id='00000000-0000-0000-0000-000000000011'),'00000000-0000-0000-0000-0000000000a1');
select test.eq('상대 수정의 최종 편집자 반영',(select last_edited_by::text from public.records where id='00000000-0000-0000-0000-000000000011'),'00000000-0000-0000-0000-0000000000a2');
select test.as_user('00000000-0000-0000-0000-0000000000b1');
select test.ok('다른 공간 스냅샷은 null',public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011') is null);
select test.raises('다른 공간 본문 변경 차단',$q$select test.write_body(315,false,6)$q$,'P0001','%RECORD_NOT_FOUND%');
select test.raises('다른 공간 사진 변경 차단',$q$select test.write_photos(316,6,'[]')$q$,'P0001','%RECORD_NOT_FOUND%');
select test.as_user('00000000-0000-0000-0000-0000000000a1');
reset role;
delete from public.couple_members where user_id='00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select test.raises('권한 해제 후 영수증 재시도 차단',$q$select test.write_body(101,true,null)$q$,'P0001','%NOT_IN_COUPLE%');
select test.ok('권한 해제 후 스냅샷 차단',public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011') is null);
reset role;
insert into public.couple_members values ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000a1','owner',now());
set role authenticated;
delete from public.records where id='00000000-0000-0000-0000-000000000011';
select test.raises('삭제 후 성공 영수증도 기록을 되살리지 않음',$q$select test.write_body(101,true,null)$q$,'P0001','%RECORD_NOT_FOUND%');
reset role;
delete from public.record_write_receipts where couple_id='00000000-0000-0000-0000-0000000000aa';
set role authenticated;
select test.raises('삭제 후 새 작업으로 같은 생성 ID 재사용 금지',$q$select test.write_body(317,true,null)$q$,'P0001','%RECORD_ID_USED%');
reset role;
set role anon;
select test.raises('익명 스냅샷 RPC 차단',$q$select public.get_record_edit_snapshot('00000000-0000-0000-0000-000000000011')$q$,'42501');
select test.raises('익명 본문 RPC 차단',$q$select test.write_body(318,true,null)$q$,'42501');
reset role;
