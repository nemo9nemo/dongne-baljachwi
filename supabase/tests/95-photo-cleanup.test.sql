select test.reset();
select test.signup('00000000-0000-0000-0000-0000000000c1','cleanup@test.invalid');
select test.seed_station('CLEANUP','정리역');
insert into public.couples(id,started_on,created_by) values('00000000-0000-0000-0000-0000000000cc',current_date,'00000000-0000-0000-0000-0000000000c1');
insert into public.couple_members(couple_id,user_id,role) values('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000c1','owner');
insert into public.records(id,couple_id,station_id,visited_on,author_id)
 select '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-0000000000cc',id,current_date,'00000000-0000-0000-0000-0000000000c1' from public.stations where code='CLEANUP';
insert into storage.objects(bucket_id,name,created_at) values
 ('record-photos','00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/old.jpg',now()-interval '8 days'),
 ('record-photos','00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/young.jpg',now()),
 ('record-photos','00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/referenced.jpg',now()-interval '8 days');
insert into public.record_photos(id,record_id,storage_path,sort_order,width,height,byte_size,content_type)
 values('00000000-0000-0000-0000-000000000991','00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/referenced.jpg',0,20,20,100,'image/jpeg');
select test.as_user('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select test.raises('정리 계획은 일반 사용자에게 비노출','select public.get_photo_cleanup_candidates()','42501');
select test.raises('정리 실행은 일반 사용자에게 거부','select public.claim_photo_cleanup(array[''test''])','42501');
reset role;
set role service_role;
select test.eq('유예기간 경과 고아만 후보',jsonb_array_length(public.get_photo_cleanup_candidates())::text,'1');
select test.eq('참조 중 파일은 확정 거부',public.claim_photo_cleanup(array['00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/referenced.jpg'])::text,'[]');
select test.eq('고아 정리 대상 확정',jsonb_array_length(public.claim_photo_cleanup(array['00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/old.jpg']))::text,'1');
select public.complete_photo_cleanup('00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/old.jpg',false);
select test.eq('실패가 재실행 가능 상태로 남음',(select last_error from public.photo_cleanup_jobs),'Storage API deletion failed');
reset role;
select test.raises('정리 중 파일을 기록에 새로 참조할 수 없음',$q$insert into public.record_photos(id,record_id,storage_path,sort_order,width,height,byte_size,content_type)
 values('00000000-0000-0000-0000-000000000992','00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-0000000000cc/00000000-0000-0000-0000-000000000111/old.jpg',1,20,20,100,'image/jpeg')$q$,'P0001','%INVALID_PHOTOS%');
update public.couples set status='dissolved',dissolved_at=now()-interval '31 days',purge_after=now()-interval '1 day' where id='00000000-0000-0000-0000-0000000000cc';
set role service_role;
select test.eq('만료 공간도 실제 파일이 남으면 DB 삭제 금지',public.finalize_expired_record_space('00000000-0000-0000-0000-0000000000cc')::text,'false');
select test.eq('만료 공간은 참조 파일까지 Storage 정리 대상',jsonb_array_length(public.get_photo_cleanup_candidates())::text,'3');
reset role;
