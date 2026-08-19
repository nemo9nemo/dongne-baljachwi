# 공통 데이터 모델 & 접근 제어 기반

> 이 문서는 화면 기능이 아니라 **모든 스펙이 공유하는 계약**이다.
> 개별 스펙의 4장은 이 문서를 참조하고, 자기 기능에서 실제로 읽고 쓰는 컬럼과
> 쿼리/뮤테이션 계약만 기술한다. **스키마 정의가 서로 어긋나면 이 문서가 정답이다.**

## 1. 목적 / 배경

동네 발자취는 순수 SPA다 (`docs/decisions/001-tech-stack.md`). 브라우저가 Supabase를
직접 호출하고, 그 사이에 서버 미들웨어가 없다. 즉 **RLS(Row Level Security)가 유일한 인가
계층**이다. 클라이언트 코드에서 `where couple_id = ...`를 빠뜨리는 것은 버그지만, RLS를
빠뜨리는 것은 **다른 커플의 연애 기록이 통째로 노출되는 사고**다.

따라서 스키마 설계의 1순위 목표는 "정규화"가 아니라 **모든 사용자 데이터 행이 예외 없이
`couple_id`를 직접 들고 있어서, RLS 정책이 조인 없이 한 줄로 평가 가능한 것**이다.

이 문서가 없으면 각 기능 스펙이 제각각 테이블을 정의해 컬럼명·타입·삭제 정책이 충돌하고,
프론트/백엔드가 서로 다른 계약을 구현하게 된다.

## 2. 사용자 시나리오

이 문서는 화면이 없다. 대신 데이터 관점의 생애주기를 기준으로 한다.

**정상 흐름**
1. 사용자가 가입한다 → `auth.users` 행 생성 → 트리거가 `profiles` 행을 자동 생성한다.
2. 커플을 만들거나(초대 코드 발급) 합류한다(코드 입력) → `couples` + `couple_members`.
3. 기록을 쓴다 → `records` + `record_photos` + `record_tags`가 모두 같은 `couple_id`를 갖는다.
4. 노선도/프로필은 `records`를 집계한 뷰를 읽는다.

**예외 흐름**
- **커플 미연결**: `couple_members`에 행이 없다. 이 상태에서 `records`에 INSERT하면 RLS가
  거부한다 (클라이언트 검증 실패 시의 최종 방어선).
- **연결 해제**: `couples.status = 'dissolved'`. 멤버십 행이 삭제되어 양쪽 모두 접근 불가.
  데이터 자체는 즉시 삭제하지 않는다 (`01-auth-couple-link.md` §3 참조).
- **역 마스터 갱신**: `stations`에서 역이 사라져도 기록은 살아 있어야 한다 → 하드 삭제 금지,
  `is_active = false`로만 내린다.

## 3. 기능 요구사항

| ID | 요구사항 | 우선순위 | 비고 |
|----|---------|---------|------|
| D-01 | 사용자 생성 데이터를 담는 모든 테이블은 `couple_id uuid NOT NULL` 컬럼을 직접 갖는다 | Must | 조인 없는 RLS 평가를 위해 의도적으로 비정규화. ADR-002 |
| D-02 | 모든 사용자 데이터 테이블에 RLS를 활성화하고, 기본 정책은 `deny`다 (정책이 없으면 접근 불가) | Must | 테이블 추가 시 정책 누락이 곧 차단으로 이어지도록 |
| D-03 | 현재 사용자의 커플 식별은 `current_couple_id()` 헬퍼 함수 하나로만 한다 | Must | 정책마다 서브쿼리를 복붙하면 한 곳만 고쳐도 구멍이 생김 |
| D-04 | `current_couple_id()`는 `SECURITY DEFINER`로 정의한다 | Must | `couple_members` 정책이 `couple_members`를 참조하면 무한 재귀. F-03 참조 |
| D-05 | 모든 PK는 `uuid`이며 DB가 생성한다 (`gen_random_uuid()`) | Must | 클라이언트가 id를 정하지 않는다. 단 마스터 데이터는 `code` 자연키를 병행 |
| D-06 | 모든 테이블에 `created_at timestamptz NOT NULL DEFAULT now()`를 둔다 | Must | |
| D-07 | 수정 가능한 테이블에 `updated_at timestamptz`와 자동 갱신 트리거를 둔다 | Must | 클라이언트가 보내는 `updated_at`은 무시한다 |
| D-08 | 기록/사진/태그의 시간은 모두 `timestamptz` (UTC 저장), 방문일자만 `date` | Must | 방문일은 "그날"이라는 사용자 의미가 있어 타임존 변환 대상이 아니다 |
| D-09 | 열거값(감정·날씨·역할 등)은 Postgres `enum` 타입이 아니라 `text` + `CHECK` 제약으로 둔다 | Must | 값 추가 시 마이그레이션 부담을 줄이기 위해. F-06 참조 |
| D-10 | 사진 원본은 Postgres가 아니라 Supabase Storage의 **비공개 버킷**에 둔다 | Must | 공개 버킷은 URL만 알면 누구나 열 수 있어 커플 격리가 깨진다 |
| D-11 | 마스터 데이터(`stations`, `lines`, `station_lines`)는 로그인한 모든 사용자에게 읽기 허용, 쓰기는 `service_role`만 | Must | 배치 전용 쓰기 (`02-station-master.md`) |
| D-12 | 집계 뷰는 `security_invoker = true`로 생성한다 | Must | 기본값(definer)이면 뷰가 RLS를 우회해 전 커플 데이터를 노출한다 |
| D-13 | 서버 타임존 의존 로직(디데이 등)은 DB가 아니라 클라이언트에서 계산한다 | Should | DB는 UTC, 사용자는 KST. 기준을 하나로 못 박기 위해 |

## 4. 데이터 모델

### 4.0 표기 규칙

- `NN` = NOT NULL, `U` = UNIQUE, `FK` = 외래키
- 타입은 Postgres 타입 표기

### 4.1 `profiles` — 사용자 프로필 (auth.users 1:1)

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `id` | uuid | NN | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `display_name` | text | NN | 1~12자. 기록의 "누가 썼는지" 표시에 쓰임 |
| `created_at` | timestamptz | NN | |
| `updated_at` | timestamptz | NN | |

- `auth.users` INSERT 시 트리거로 자동 생성한다. `display_name` 초기값은 이메일 로컬파트를
  잘라 넣고, 온보딩에서 사용자가 덮어쓴다 (빈 문자열 상태를 만들지 않기 위해).
- 이메일은 `profiles`에 복제하지 않는다. `auth.users`가 단일 출처다.

**RLS**
- SELECT: `id = auth.uid() OR id IN (같은 커플 멤버의 user_id)` — 상대방 이름을 표시해야 하므로
- UPDATE: `id = auth.uid()`
- INSERT/DELETE: 클라이언트 금지 (트리거/CASCADE로만)

### 4.2 `couples` — 커플

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `id` | uuid | NN | PK |
| `started_on` | date | NN | 사귀기 시작한 날. 디데이 계산 기준. 미래 날짜 금지 |
| `status` | text | NN | CHECK in (`'active'`, `'dissolved'`), 기본 `'active'` |
| `dissolved_at` | timestamptz | | `status='dissolved'`일 때만 값 존재 |
| `purge_after` | timestamptz | | 해제 시 `dissolved_at + 30일`. 배치 영구 삭제 기준 |
| `created_by` | uuid | NN | FK → `profiles(id)` |
| `created_at` / `updated_at` | timestamptz | NN | |

- 커플 표시명 컬럼은 두지 않는다. 프로필 화면의 "이름"은 두 멤버의 `display_name`으로 구성한다
  (`09-couple-profile.md` §4). → 미결정 항목 참조
- 멤버가 1명뿐인 상태도 `active`다. "상대 합류 대기"는 별도 status가 아니라
  `member_count = 1`로 파생한다 (상태 조합 폭발을 막기 위해).

**RLS**
- SELECT/UPDATE: `id = current_couple_id()`
- INSERT: `created_by = auth.uid()` **그리고** 호출자가 아직 어느 커플에도 속하지 않을 것
- DELETE: 클라이언트 금지 (해제는 UPDATE, 영구 삭제는 배치)

### 4.3 `couple_members` — 커플 멤버십 (커플 격리의 뿌리)

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `couple_id` | uuid | NN | PK(복합), FK → `couples(id)` ON DELETE CASCADE |
| `user_id` | uuid | NN | PK(복합), FK → `profiles(id)` ON DELETE CASCADE |
| `role` | text | NN | CHECK in (`'owner'`, `'partner'`) |
| `joined_at` | timestamptz | NN | |

**핵심 제약 (DB가 강제한다, 애플리케이션 검증에 의존하지 않는다)**

| 제약 | 형태 | 막는 사고 |
|---|---|---|
| 커플당 최대 2명 | `UNIQUE (couple_id, role)` | 초대 코드 유출로 3명째가 합류 |
| 한 사람은 한 커플만 | `UNIQUE (user_id)` | 동시에 두 커플에 소속되어 기록이 섞임 |

- 연결 해제 시 두 행 모두 **삭제**한다. 이력은 `couples.status/dissolved_at`에 남는다.
- 별도 멤버십 이력 테이블은 두지 않는다 (재결합·복수 커플 이력은 요구사항에 없음).

**RLS**
- SELECT: `couple_id = current_couple_id()`
- INSERT/UPDATE/DELETE: **클라이언트 직접 금지.** 오직 `01-auth-couple-link.md`의
  SECURITY DEFINER 함수(`create_couple`, `redeem_invite`, `dissolve_couple`)를 통해서만 변경한다.
  이유: 멤버십은 인가의 뿌리이므로 변경 경로를 하나로 좁혀야 감사·검증이 가능하다.

### 4.4 `current_couple_id()` — RLS 헬퍼

- 반환: `uuid` (커플 미연결이면 `NULL`)
- 구현 성격: `STABLE`, `SECURITY DEFINER`, `search_path` 고정
- 정의: `auth.uid()`의 `couple_members` 행에서 `couple_id`를 반환. 단, 해당 `couples.status`가
  `'active'`가 아니면 `NULL`을 반환한다 → **해제된 커플의 데이터는 자동으로 전원 접근 불가**가 된다.
- SECURITY DEFINER인 이유: `couple_members`의 RLS 정책이 다시 `couple_members`를 조회하면
  정책 평가가 재귀한다. DEFINER 함수는 RLS를 우회해 조회하므로 재귀가 끊긴다. (D-04)
- 모든 사용자 데이터 테이블의 정책은 **정확히 이 표현식만** 쓴다:
  `couple_id = current_couple_id()`
  `current_couple_id()`가 NULL이면 `NULL = NULL`은 참이 아니므로 자동으로 0행이 된다.

### 4.5 `records` — 데이트 기록

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `id` | uuid | NN | PK |
| `couple_id` | uuid | NN | FK → `couples(id)` ON DELETE CASCADE |
| `station_id` | uuid | NN | FK → `stations(id)` **ON DELETE RESTRICT** |
| `visited_on` | date | NN | 미래 날짜 금지, `couples.started_on` 이전도 허용(연애 전 만남 기록 가능) |
| `mood` | text | | CHECK in (`happy`,`love`,`excited`,`calm`,`sad`) |
| `weather` | text | | CHECK in (`sunny`,`cloudy`,`rainy`,`snowy`,`windy`) |
| `note` | text | | 최대 1,000자 (CHECK) |
| `author_id` | uuid | NN | FK → `profiles(id)`. **최초 작성자, 변경 불가** |
| `last_edited_by` | uuid | | FK → `profiles(id)`. 마지막 수정자 |
| `created_at` / `updated_at` | timestamptz | NN | |

- `mood`/`weather`는 NULL 허용이다. PRD §5.2는 "입력 마찰이 적은 것"이 목적이므로 필수화하지 않는다.
- `station_id`가 RESTRICT인 이유: 역 마스터 재적재가 기록을 소리 없이 지우는 사고를 원천 차단.
- 삭제는 하드 삭제다 (`06-record-detail.md` F-07). 휴지통 요구사항이 없어 soft delete를 두지 않는다.

**인덱스**
- `(couple_id, visited_on DESC, id DESC)` — 타임라인 키셋 페이지네이션
- `(couple_id, station_id)` — 역 상세 / 방문 집계

**RLS** — SELECT/INSERT/UPDATE/DELETE 모두 `couple_id = current_couple_id()`
추가로 INSERT 시 `author_id = auth.uid()` 강제 (남의 이름으로 기록 생성 방지).
UPDATE 시 `author_id`는 변경 불가 (트리거로 이전 값 유지).

> **커플 내부 권한**: 상대가 쓴 기록도 **수정·삭제할 수 있다.** 커플의 공동 아카이브라는
> 제품 성격상 소유권을 개인 단위로 쪼개지 않는다. 대신 `author_id`/`last_edited_by`로
> "누가 썼고 누가 마지막에 고쳤는지"는 항상 보이게 한다.

### 4.6 `record_photos` — 기록 사진

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `id` | uuid | NN | PK |
| `record_id` | uuid | NN | FK → `records(id)` ON DELETE CASCADE |
| `couple_id` | uuid | NN | FK → `couples(id)`. RLS 축 (의도적 비정규화) |
| `storage_path` | text | NN | U. `{couple_id}/{record_id}/{photo_id}.{ext}` |
| `sort_order` | smallint | NN | 0부터. `UNIQUE (record_id, sort_order)` |
| `width` / `height` | int | NN | 표시 시 레이아웃 시프트 방지용 |
| `byte_size` | int | NN | |
| `content_type` | text | NN | CHECK in (`image/jpeg`,`image/png`,`image/webp`) |
| `created_at` | timestamptz | NN | |

- **기록당 최대 10장.** 클라이언트 검증 + DB 트리거 이중 방어.
- `couple_id`는 트리거로 `records`에서 복사해 채운다 (클라이언트 값 신뢰 금지).

**Storage 계약**
- 버킷: `record-photos`, **비공개**
- 경로 규칙: 1번째 세그먼트가 반드시 `couple_id`
- Storage RLS: `(storage.foldername(name))[1]::uuid = current_couple_id()`
- 표시 URL: **서명 URL(유효기간 1시간)**. 공개 URL을 쓰지 않는다.
- 고아 파일: 기록 삭제 시 클라이언트가 DB 행 삭제 → Storage 객체 삭제 순으로 수행하고,
  실패 시를 대비해 배치가 `record_photos`에 없는 객체를 주기적으로 정리한다.

### 4.7 `record_tags` — 자유 태그

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `record_id` | uuid | NN | PK(복합), FK → `records(id)` ON DELETE CASCADE |
| `tag_norm` | text | NN | PK(복합). 정규화된 비교용 키 |
| `couple_id` | uuid | NN | FK → `couples(id)`. RLS 축 |
| `tag` | text | NN | 사용자가 입력한 표기 그대로 (표시용) |
| `created_at` | timestamptz | NN | |

**태그 정규화 규칙 (프론트/백엔드 공통, 이 규칙이 계약이다)**
1. 유니코드 NFC 정규화
2. 앞뒤 공백 제거, 내부 연속 공백은 1칸으로 축약
3. 선행 `#` 문자 제거
4. `tag`는 위 결과를 그대로 저장, `tag_norm`은 여기에 **소문자 변환**까지 적용
5. 길이 검증은 `tag` 기준 1~20자 (한글 기준 자모 아닌 완성형 문자 수)
6. 기록당 최대 10개. 같은 기록 내 `tag_norm` 중복은 조용히 무시(에러 아님)

- 소문자 변환을 `tag_norm`에만 적용하는 이유: "Cafe"와 "cafe"를 같은 필터로 묶되, 화면에는
  사용자가 쓴 대로 보여주기 위해서다.
- 태그 사전 테이블은 두지 않는다 (PRD §5.3: "사용자가 쓴 태그가 곧 필터 목록").

**인덱스**: `(couple_id, tag_norm)`
**RLS**: `couple_id = current_couple_id()`

### 4.8 마스터 데이터

`lines`, `stations`, `station_lines`의 상세 정의는 `02-station-master.md` §4가 정본이다.
공통 규칙만 여기 못 박는다.

- 세 테이블 모두 `couple_id`가 **없다**. 커플 데이터가 아니다.
- RLS: SELECT는 `auth.role() = 'authenticated'`, INSERT/UPDATE/DELETE는 정책 없음
  (= `service_role` 배치만 가능).
- 삭제하지 않는다. `is_active = false`로만 내린다.

### 4.9 집계 뷰

| 뷰 | 용도 | 정의 요약 |
|---|---|---|
| `couple_station_visits` | 노선도 스탬프/뱃지, 지도 핀, 안 가본 역 추천 | `records` GROUP BY `couple_id, station_id` → `visit_count`, `first_visited_on`, `last_visited_on` |
| `couple_tag_usage` | 타임라인 태그 칩 목록/정렬 | `record_tags` GROUP BY `couple_id, tag_norm` → `usage_count`, 대표 `tag`(최근 사용 표기) |

- 두 뷰 모두 `security_invoker = true` (D-12). 없으면 전 커플 데이터가 새어 나간다.
- 뷰는 실시간 계산이다. 머티리얼라이즈드 뷰/집계 테이블은 두지 않는다 — 커플 1쌍의 기록은
  수백~수천 행 규모라 인덱스 스캔으로 충분하고, 갱신 동기화 비용이 이득보다 크다.

### 4.10 전체 관계 요약

```
auth.users 1─1 profiles ─┐
                          ├─ couple_members ─ couples
                          │        (UNIQUE user_id / UNIQUE couple_id,role)
                          │
records ─ couple_id ──────┘
   ├─ station_id → stations ─ station_lines ─ lines
   ├─ record_photos (couple_id 중복 보유)
   └─ record_tags   (couple_id 중복 보유)
```

## 5. 상태 정의

데이터 계층에서 클라이언트가 반드시 구분해야 하는 상태.

| 상태 | 판별 | 화면 동작 |
|---|---|---|
| 미인증 | Supabase 세션 없음 | 로그인/가입 화면 |
| 인증됨 · 커플 미연결 | 세션 있음 + `current_couple_id()` NULL | 온보딩(코드 발급/입력) 강제 |
| 인증됨 · 커플 연결(1인) | 멤버 1명 | 전 기능 사용 가능 + 상단에 "상대 초대 대기" 배너 |
| 인증됨 · 커플 연결(2인) | 멤버 2명 | 정상 |
| 커플 해제됨 | 세션 있음 + 멤버십 행 없음 + 직전 커플 `dissolved` | 온보딩으로 복귀. 이전 기록은 보이지 않는다 |
| 권한 오류 | RLS로 0행 또는 `42501` | "권한이 없습니다" — 재시도 버튼을 주지 않는다 (재시도해도 동일) |
| 네트워크 오류 | fetch 실패 | 재시도 가능한 에러. 마지막 성공 캐시가 있으면 stale 표시 후 유지 |

- **RLS 거부와 "데이터 없음"을 화면에서 구분할 수 없다는 점을 전제로 설계한다.** SELECT는
  거부 대신 0행을 반환하기 때문이다. 따라서 "빈 상태" 문구는 "권한이 없다"가 아니라
  "아직 기록이 없어요"여야 한다.

## 6. 비기능 요구사항

- **쿼리 예산**: 화면 최초 진입 시 Supabase 왕복 3회 이하. 노선도 화면은 마스터 데이터 1회 +
  방문 집계 1회 = 2회.
- **응답 목표**: 커플당 기록 5,000행 기준, 타임라인 1페이지(20건) 및 방문 집계 쿼리 p95 300ms 이하.
- **마스터 데이터 규모**: 수도권 기준 역 약 700, 노선 약 25, 역-노선 약 1,000행. 전국으로
  확장해도 역 1,100 수준(전국도시철도역사정보표준데이터 1,073행)이라 **같은 설계가 그대로 성립한다.**
- **마스터 캐시**: `lines`/`stations`/`station_lines`는 클라이언트에서 로컬 캐시하고,
  `master_version` 값으로 무효화한다 (`02-station-master.md` F-09).
- **보안**: `service_role` 키는 브라우저 번들에 절대 포함하지 않는다 (`CLAUDE.md` 공통 규약).
  RLS 정책은 테이블 생성과 **같은 마이그레이션**에서 함께 적용한다 (정책 없는 노출 구간 0초).

## 7. 확장 포인트

| 지점 | 지금 | 왜 열어두는가 |
|---|---|---|
| `couple_members.role` | `owner`/`partner` 2값 | 역할 개념이 이미 있으므로, 후일 권한 분리가 필요해도 컬럼 추가가 불필요 |
| `mood`/`weather` CHECK 제약 | 5값 고정 | 값 추가가 마이그레이션 1줄. 종류가 20개를 넘거나 커플별 커스텀이 생기면 참조 테이블로 승격 |
| `records.station_id` | 역 1개 필수 | 장소(카페/식당) 단위 기록으로 세분화될 경우 `record_places` 자식 테이블을 추가하면 되고, 역 기준 집계는 그대로 유지된다 |
| 집계 뷰 | 실시간 뷰 | 규모가 커지면 뷰 이름을 유지한 채 머티리얼라이즈드 뷰로 교체 가능 (호출부 무변경) |
| `couples.status` | `active`/`dissolved` | 값 추가로 대응 |
| Storage 경로 | `{couple_id}/...` | 첫 세그먼트가 격리 축이므로, 다른 종류의 첨부(음성 메모 등)가 생겨도 같은 정책 재사용 |

**의도적으로 만들지 않는 것**: 다중 커플 지원, 기록 소유권 분리, 감사 로그 테이블,
soft delete 인프라. 요구사항이 없고, 지금 넣으면 RLS 정책이 복잡해져 사고 확률만 올라간다.

## 8. 완료 조건 (Acceptance Criteria)

- **AC-01** Given 커플 A의 사용자가 로그인했고 커플 B의 기록이 존재할 때,
  When 클라이언트가 `records`를 필터 없이 전체 조회하면,
  Then 커플 B의 행은 0건 반환된다.
- **AC-02** Given 커플 A 사용자가 로그인했을 때,
  When 커플 B의 `couple_id`를 직접 지정해 `records`에 INSERT를 시도하면,
  Then RLS 위반으로 실패한다.
- **AC-03** Given 커플 A 사용자가 로그인했을 때,
  When 커플 B의 사진 `storage_path`를 알고 서명 URL 생성을 시도하면,
  Then Storage 정책에 의해 거부된다.
- **AC-04** Given 커플에 이미 2명이 있을 때,
  When 3번째 `couple_members` 행 삽입을 시도하면,
  Then `UNIQUE (couple_id, role)` 위반으로 실패한다.
- **AC-05** Given 사용자가 이미 어떤 커플의 멤버일 때,
  When 다른 커플의 멤버 행 삽입을 시도하면,
  Then `UNIQUE (user_id)` 위반으로 실패한다.
- **AC-06** Given 커플이 `dissolved` 상태일 때,
  When 그 커플의 이전 멤버가 `records`를 조회하면,
  Then 0건이 반환된다 (`current_couple_id()`가 NULL).
- **AC-07** Given `records`가 존재하는 역일 때,
  When 배치가 해당 `stations` 행 DELETE를 시도하면,
  Then FK RESTRICT로 실패한다.
- **AC-08** Given 집계 뷰 `couple_station_visits`가 있을 때,
  When 커플 A 사용자가 뷰를 조회하면,
  Then 커플 A의 행만 반환된다 (`security_invoker` 검증).
- **AC-09** Given 사용자가 태그 `" #Cafe "`를 입력했을 때,
  When 저장되면, Then `tag = "Cafe"`, `tag_norm = "cafe"`로 저장된다.
- **AC-10** Given 기록에 사진이 10장 있을 때,
  When 11번째 사진 행을 추가하면, Then 거부된다.

## 9. 미결정 항목

> ❓ **커플 표시명**: 프로필 화면의 "이름"이 (a) 두 사람 이름을 나란히 보여주는 것인지,
> (b) "우리" 같은 커플 공동 별칭을 따로 정하는 것인지. 현재는 (a)로 가정하고 `couples`에
> 이름 컬럼을 두지 않았다. (b)라면 `couples.title text` 추가가 필요하다.

> ❓ **해제 후 데이터 보존 기간 30일**: 임의로 정한 값이다. 즉시 삭제를 원하는지,
> 더 길게(예: 1년) 보관을 원하는지 확인 필요. 해제 전 기록 일괄 내보내기(백업) 기능이
> 필요한지도 미정 — PRD에 없어 이번 범위에서 제외했다.

> ❓ **계정 삭제(탈퇴)**: PRD에 없다. `auth.users` 삭제 시 `profiles`가 CASCADE되고,
> 그 사람이 쓴 `records.author_id`가 어떻게 되어야 하는지(NULL 허용 / 탈퇴 표시 유지)
> 결정되지 않았다. 현재 스키마는 `author_id`가 NOT NULL이라 탈퇴 시 FK 충돌이 난다.

> ✅ **결정 완료 (2026-08-15)**: 기록 최대 사진 **10장**으로 확정 (`20260815100000_relax_record_limits.sql`).
> 이전 상한(5장)에서 상향했다.

> ✅ **결정 완료 (2026-08-15)**: `note` 상한 **1,000자**로 확정 (이전 2,000자에서 하향,
> `20260815100000_relax_record_limits.sql`).

---

### 변경 이력
- 2026-08-11 최초 작성. PRD §3·§4를 근거로 전 스펙 공통 계약 확정.
- 2026-08-15 사진 상한 5장→10장, `note` 상한 2,000자→1,000자로 확정(§9).
