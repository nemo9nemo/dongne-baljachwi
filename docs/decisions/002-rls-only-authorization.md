# 002 — RLS 단일 인가 계층과 `couple_id` 비정규화

## 배경

`001-tech-stack.md`에서 Vite+React SPA + Supabase 직접 호출로 확정했다. 이 구조에는
**서버 미들웨어가 없다.** 브라우저가 `anon` 키로 Supabase에 직접 요청하고, 그 사이에
요청을 검사할 애플리케이션 서버가 존재하지 않는다.

한편 이 서비스는 커플 전용 비공개 아카이브다. 데이터가 새면 "다른 사용자의 연애 기록과
사진"이 노출된다. 일반적인 SaaS의 데이터 유출보다 정서적 피해가 크고 회복이 불가능하다.

즉 **인가를 어디서 어떻게 강제할 것인가**를 스키마 설계 이전에 확정해야 했다.

## 선택지

### A. 클라이언트 쿼리 조건에 의존
모든 쿼리에 `.eq('couple_id', myCoupleId)`를 붙인다.
- 구현 비용 0
- **한 군데만 빠뜨려도 전체 노출.** `anon` 키로 브라우저 콘솔에서 임의 쿼리가 가능하므로
  애초에 인가가 아니라 필터일 뿐이다. **채택 불가.**

### B. Edge Function을 API 계층으로 두고 그 안에서만 DB 접근
- 서버 인가 계층이 생김
- Next.js를 버린 이유(ADR-001)가 무색해진다. 모든 CRUD에 함수를 만들어야 하고,
  Supabase 클라이언트의 이점(실시간 반영, 자동 타입)을 잃는다
- 함수도 결국 `service_role`로 접근하므로 함수 안에서 조건을 빠뜨리면 같은 사고

### C. RLS를 유일한 인가 계층으로 삼고, 모든 데이터 테이블에 `couple_id`를 직접 둔다
- DB가 인가를 강제한다. 클라이언트가 무엇을 보내든 정책을 통과하지 못하면 0행
- 정책 표현식이 `couple_id = current_couple_id()` 하나로 통일되어 감사(review)가 쉽다
- 대가: 정규화를 포기한다 (`record_photos`, `record_tags`가 `couple_id`를 중복 보유)

### D. C + 멤버십 변경만 SECURITY DEFINER 함수로 제한
- C에 더해, 인가의 뿌리인 `couple_members`는 클라이언트가 직접 쓸 수 없게 한다

## 결정 (2026-08-11)

**D를 채택한다.**

1. 사용자 데이터를 담는 모든 테이블은 `couple_id uuid NOT NULL`을 **직접** 갖는다.
   `record_photos`/`record_tags`는 부모를 조인하면 알 수 있는 값이지만 중복 보유한다.
2. 모든 정책은 예외 없이 `couple_id = current_couple_id()` 한 가지 표현식만 쓴다.
3. `current_couple_id()`는 `STABLE SECURITY DEFINER` 함수이며,
   커플이 `dissolved`면 `NULL`을 반환한다.
4. `couple_members`의 INSERT/UPDATE/DELETE는 클라이언트에 열지 않는다.
   `create_couple` / `redeem_invite` / `dissolve_couple` 세 함수로만 변경한다.
5. 집계 뷰는 전부 `security_invoker = true`로 만든다.
6. Storage는 비공개 버킷 + 경로 첫 세그먼트를 `couple_id`로 강제한다.
7. 테이블 생성과 RLS 정책 적용은 **같은 마이그레이션**에 넣는다.

세부 스키마는 `docs/specs/00-data-model.md`가 정본이다.

## 트레이드오프

**얻은 것**
- 인가 규칙이 한 줄로 통일되어, 새 테이블을 추가할 때 "이 정책이 맞는가"를 즉시 판단할 수 있다.
- 정책 평가에 조인이 없다. 인덱스만 있으면 성능 부담이 사실상 없다.
- 클라이언트 코드의 버그가 데이터 유출로 이어지지 않는다. 최악의 경우도 "안 보임"이다.

**포기한 것**
- 정규화. `couple_id`가 세 테이블에 중복된다. 트리거로 부모 값을 복사해 채우므로
  **클라이언트가 보낸 `couple_id`는 신뢰하지 않는다** — 이 트리거가 빠지면 비정규화가
  곧 불일치가 된다.
- `couple_members`의 유연성. 멤버십 변경 경로가 3개 함수로 고정되어, 새로운 연결 시나리오가
  생기면 함수를 고쳐야 한다.

**되돌리기 어려운 이유**
- 나중에 `couple_id`를 제거하고 조인 기반 정책으로 바꾸려면 모든 정책·인덱스·쿼리를
  다시 써야 한다.
- 반대로 인가를 애플리케이션 계층으로 옮기려면 서버를 도입해야 하고, 그건 ADR-001을
  뒤집는 일이다.

**알려진 함정 (구현 시 반드시 확인)**
- `couple_members`의 정책이 `couple_members`를 조회하면 **정책 평가가 무한 재귀**한다.
  `current_couple_id()`를 SECURITY DEFINER로 만든 것은 이 재귀를 끊기 위해서다.
- 뷰의 기본값은 `security_definer`다. `security_invoker = true`를 빠뜨리면
  **뷰가 RLS를 우회해 전 커플 데이터를 반환한다.** 가장 사고 확률이 높은 지점이다.
- Storage는 **읽기 정책과 쓰기 정책이 별개다.** 읽기만 걸고 쓰기를 잊으면 다른 커플
  폴더에 파일을 올릴 수 있다.
- SELECT에 대한 RLS 거부는 에러가 아니라 **0행**이다. 화면 문구를 "권한 없음"이 아니라
  "데이터 없음"으로 써야 한다.

## 관련 문서

- `docs/specs/00-data-model.md` — 전체 스키마와 정책 목록
- `docs/specs/01-auth-couple-link.md` — 멤버십 변경 함수 3종의 계약
