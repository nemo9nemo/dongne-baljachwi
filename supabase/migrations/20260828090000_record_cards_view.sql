-- ============================================================================
-- 목록 카드 전용 뷰: record_cards
--
-- 근거: docs/specs/04-station-detail.md §4.1 (RecordCard 계약),
--       docs/specs/08-timeline.md (같은 카드 shape 재사용),
--       docs/specs/00-data-model.md §4.9 (뷰는 예외 없이 security_invoker)
--
-- 왜 만드는가:
--   04 §4.1 은 목록 응답에 일기(note) **앞 200자만** 실으라고 못박는다. 이유는 대역폭이
--   아니라 프라이버시다 — 목록 응답은 클라이언트 캐시·중간 로그·에러 리포트를 타고 여러
--   곳에 복제되는데, 거기에 일기 전문이 실려 다니면 안 된다.
--   PostgREST 는 컬럼을 고를 수만 있고 자를 수는 없으므로, 절단은 DB가 해야 한다.
--   지금까지는 클라이언트가 note 전문을 받아 slice(0,200) 했다 — 잘린 건 화면뿐이고
--   네트워크·캐시에는 전문이 그대로 남아 스펙의 목적을 달성하지 못했다(QA 항목 13).
--
-- 경계:
--   이 뷰는 **목록 전용**이다. 기록 상세(06)는 record_id 단건 조회로 note 전문이 필요하며,
--   public.records 를 그대로 읽는다. 상세 경로는 이 뷰와 무관하다.
-- ============================================================================

-- ⚠ security_invoker = true 필수 (D-12). 빠뜨리면 뷰 소유자 권한으로 평가되어
-- records 의 RLS 를 우회하고 **전 커플의 일기 발췌**가 새어 나간다.
-- 이 뷰는 자체 RLS 정책을 갖지 않는다 — records 의 records_select 정책
-- (couple_id = current_couple_id()) 을 그대로 상속하는 것이 유일한 인가 수단이다.
create view public.record_cards
with (security_invoker = true) as
select
  r.id,
  r.station_id,
  r.visited_on,
  r.mood,
  r.weather,
  -- 04 §4.1: 목록 카드는 2줄만 쓴다. left() 는 바이트가 아니라 문자 단위라
  -- 한글에서도 200'자'다. note 가 NULL 이면 NULL 그대로 (빈 문자열로 바꾸지 않는다 —
  -- 프론트가 "일기 없음"과 "빈 일기"를 구분할 수 있어야 한다).
  left(r.note, 200) as note_excerpt,
  r.author_id
from public.records r;

comment on view public.record_cards is
  '목록 카드 전용 투영 (04 §4.1). note 전문 대신 앞 200자(note_excerpt)만 노출한다. '
  'security_invoker=true — RLS 는 records 정책을 따른다. 상세 조회는 records 를 직접 읽는다.';

comment on column public.record_cards.note_excerpt is
  '일기 앞 200자. 전문이 필요한 화면(06 기록 상세)은 records.note 를 단건 조회한다.';

-- 이 뷰는 단순 투영이라 Postgres 가 호출부 쿼리에 인라인한다. 따라서 목록의 접근 패턴
--   where couple_id = ? [and station_id = ?] and (visited_on, id) < (?, ?)
--   order by visited_on desc, id desc limit 20
-- 은 records_timeline_idx (couple_id, visited_on desc, id desc) 와
-- records_couple_station_idx (couple_id, station_id) 를 그대로 탄다. 전용 인덱스는 없다.

-- Supabase 기본 권한은 새 객체에 ALL 을 준다. 이 뷰는 단순 투영이라 Postgres 기준
-- **자동 갱신 가능(auto-updatable)** 하므로, 권한을 걷어내지 않으면 클라이언트가
-- 뷰를 통해 records 를 INSERT/UPDATE/DELETE 할 수 있다. 목록 조회 전용으로 못박는다.
revoke all on public.record_cards from anon, authenticated;
grant select on public.record_cards to authenticated;
