-- ============================================================================
-- 집계 뷰 (00 §4.9, D-12)
--
-- ⚠ 뷰의 기본값은 security_definer 다. `with (security_invoker = true)` 를 빠뜨리면
-- 뷰가 RLS를 우회해 **전 커플 데이터를 반환한다.** ADR-002 가 "가장 사고 확률이 높은
-- 지점"으로 지목한 곳이다. 이 파일에 뷰를 추가할 때 반드시 같이 붙인다.
--
-- 머티리얼라이즈드 뷰를 쓰지 않는 이유: 커플 1쌍의 기록은 수백~수천 행 규모라
-- 인덱스 스캔으로 충분하고, 갱신 동기화 비용이 이득보다 크다. 규모가 커지면 뷰 이름을
-- 유지한 채 교체할 수 있다 (00 §7).
-- ============================================================================

-- 노선도 스탬프/뱃지, 지도 핀, 안 가본 역 추천의 공통 소스.
-- records_couple_station_idx (couple_id, station_id) 가 그대로 GROUP BY 인덱스다.
create view public.couple_station_visits
with (security_invoker = true) as
select
  r.couple_id,
  r.station_id,
  count(*)::int  as visit_count,
  min(r.visited_on) as first_visited_on,
  max(r.visited_on) as last_visited_on
from public.records r
group by r.couple_id, r.station_id;

comment on view public.couple_station_visits is
  '커플별 역 방문 집계 (00 §4.9). security_invoker=true — RLS는 records 정책을 따른다.';

-- 타임라인 태그 칩 목록/정렬용.
-- 대표 tag 표기는 "가장 최근에 쓴 표기"를 쓴다. 같은 tag_norm 에 Cafe/cafe 가 섞여 있을 때
-- 칩에 무엇을 보여줄지 기준이 없으면 조회마다 표기가 흔들린다.
create view public.couple_tag_usage
with (security_invoker = true) as
select
  t.couple_id,
  t.tag_norm,
  count(*)::int as usage_count,
  (array_agg(t.tag order by t.created_at desc, t.record_id desc))[1] as tag
from public.record_tags t
group by t.couple_id, t.tag_norm;

comment on view public.couple_tag_usage is
  '커플별 태그 사용 집계 (00 §4.9). 대표 표기는 최근 사용 표기.';

-- Supabase 기본 권한은 새 객체에 ALL 을 부여한다. 집계 뷰는 읽기 전용이므로 나머지를 걷어낸다.
-- (GROUP BY 뷰라 어차피 갱신 불가지만, 권한 목록만 보고도 의도를 알 수 있게 한다.)
revoke all on public.couple_station_visits from anon, authenticated;
revoke all on public.couple_tag_usage      from anon, authenticated;
grant select on public.couple_station_visits to authenticated;
grant select on public.couple_tag_usage      to authenticated;
