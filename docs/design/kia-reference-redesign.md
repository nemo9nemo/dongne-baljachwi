# 기아 레퍼런스 전면 재브랜딩 — 판단·매핑 기록 (2026-08-31)

> 트리거: 사용자가 기아 웹사이트 디자인 시스템(`auto-stock` 프로젝트의 `DESIGN.md`에서 발췌한
> 색·형태·타이포·상태 규칙)을 레퍼런스로 지정하고 **이 앱의 전면 재브랜딩을 명시적으로 확정**했다.
> 이전 방향(Resend 레퍼런스, 2026-08-21)은 이 문서로 대체된다 —
> `docs/design/redesign-resend-reference.md`는 히스토리 보존용으로 남되 **폐기 표시**가 붙었다.
>
> 실제 변경분은 `src/styles/tokens.css`(단일 소스) + 각 `*.module.css` + `components/ui/button.tsx`
> + `tailwind.config.ts`. 토큰 목록·사용처는 `docs/design/system.md`.

---

## 1. 한 문장 요약

**순검정과 그림자와 알약을 걷어내고, 차콜 네이비(#05141f) 하나 · 각진 컨트롤 · 15px 카드 ·
두 굵기 타이포로 다시 세웠다.** 지하철 노선 색과 감정·날씨 이모지는 정보이므로 손대지 않았다.

## 2. 토큰 매핑표 — 기아 원본 값 → 이 프로젝트 토큰

### 2.1 색

| 기아 레퍼런스 | 값 | 이 프로젝트 토큰(라이트) | 이 프로젝트 토큰(다크) |
|---|---|---|---|
| Primary / 차콜 네이비 | `#05141f` | `--charcoal`(원시) → `--color-text`, `--color-primary`, `--color-danger`, `--color-focus` | `--color-text-inverse`, `--color-surface` |
| Dark Surface | `#010e18` | — (라이트에서 안 씀) | `--charcoal-deep`(원시) → `--color-bg` |
| Pure White | `#ffffff` | `--white` → `--color-bg`, `--color-surface`, `--color-text-inverse` | `--color-text`, `--color-primary` |
| Surface Grey | `#f8f8f8` | `--gray-50` → `--color-surface-muted`, `--color-field`, `--color-primary-soft`, `--color-danger-soft`, `--color-notice-bg`, `--app-backdrop` | (다크는 `--gray-850 #14232e`가 같은 역할) |
| Border Grey | `#dadce0` | `--gray-200` → `--color-border`, `--color-notice-border`, `--app-frame-border` | `--color-primary-hover`, `--color-danger-hover` |
| Body Slate | `#37434b` | `--gray-700` → `--color-text-muted` | (다크는 `--gray-300 #b9bfc4`) |
| Steel Grey | `#697278` | `--gray-600` → `--color-text-subtle`, `--color-border-strong`, `--color-primary-disabled` | (다크는 `--gray-500 #79838b` = Steel Alt) |
| Steel Alt | `#79838b` | `--gray-500` → `--line-default` | `--color-border-strong`, `--color-primary-disabled` |
| (보간) | `#f1f2f4` `#e9ebee` `#b9bfc4` `#9299a0` `#2a3a45` `#14232e` | `--gray-100/150/300/400/800/850` | 다크 서피스·보더 단계 |

> 램프의 **양 끝과 여섯 개 고정점이 전부 기아의 명명된 색 그대로**다. 사이 단계만 보간했고,
> 중성 회색을 쓰지 않았다 — 차콜 옆에 중성 회색을 놓으면 누렇게 뜬다.

**채도 있는 강조색은 하나도 없다.** 레드/블루/오렌지가 UI 크롬에 등장하지 않는다.
`--color-danger`가 `--color-primary`와 같은 차콜인 것도 그래서다(기아도 에러 텍스트를
`#05141f`로 쓴다) — 위험한 동작은 **색이 아니라 윤곽→채움 형태 전환**으로 구분한다.
이건 2026-08-19 흑백 개편에서 이미 확정돼 대비 계산까지 끝난 리포지토리 사실이라 그대로 계승했다.

### 2.2 형태 · 그림자

| 기아 레퍼런스 | 이 프로젝트 |
|---|---|
| 버튼 `border-radius: 0`, padding `16px 24px`, height `48px` | `--radius-control: 0px`, `min-h-control`(48px) + `px-6`(24px). `button.tsx` 전 변형 공통 |
| 카드 `border-radius: 15px` (시스템에서 유일하게 둥근 요소) | `--radius-card: 15px` — `ui.card`, `RecordCard.card`, 다이얼로그 3종, 지도 빈 상태 오버레이, 카드 스켈레톤 |
| 섹션 `radius: 0` | 입력·배너·칩·태그·메뉴·토스트·FAB·썸네일 전부 `--radius-control`(0) |
| **그림자 없음** (`box-shadow: none` 전체) | `--shadow-card/dialog/button/button-hover/frame` **토큰 자체를 삭제**. Tailwind `boxShadow` 확장도 삭제. 앱 전체에 `box-shadow` 선언 0개 |
| 깊이는 배경색 대비로만 | 다이얼로그 3종·지도 정보창·열린 메뉴에 **1px 테두리를 추가**해 그림자가 지던 경계 역할을 넘겼다. 앱 프레임(≥768px)은 `흰 프레임 ↔ Surface Grey 백드롭` 대비 + 1px 경계로 뜬다 |

폐기: `--radius-pill`(999px). 이 브랜드에 알약은 없다 — 칩·태그·토스트·FAB가 전부 각졌다.
남긴 것은 `--radius-circle: 50%` 하나이고, **진짜 원형 도형**(워드마크 발자국 점, 노선 색 점)에만 쓴다.

폐기: `--color-hairline`(반투명 장식 경계, Resend 라운드 도입). 기아 시스템의 경계는 Border Grey
하나이고, 반투명 경계는 이 시스템의 어휘가 아니다. 컴포넌트 사용처가 0건이라 제거 비용도 없었다.

폐기: `--app-screen-wash`(화면 상단 그라디언트 워시), `--app-backdrop`의 그라디언트.
플랫 원칙에 정면으로 어긋난다. 백드롭은 단색 `#f8f8f8`(다크 `#05141f`)이 됐다.

### 2.3 타이포

| 기아 레퍼런스 | 이 프로젝트 |
|---|---|
| 전용 서체(Kia Signature Bold/Regular) | **없으므로 대체.** 이미 로드 중인 Noto Sans KR(`@fontsource/noto-sans-kr`) + Inter(`@fontsource/inter`, 숫자 전용 `--font-numeric`). 새 폰트를 추가하지 않았다 |
| Bold 하나 + Regular 하나, 중간 굵기 남발 금지 | `--font-weight-medium`(500) **토큰 삭제**. 7개 사용처를 Bold(폼 라벨, 카드 날짜, 검색 결과명, 추천 칩 이름, 지도 정보창 버튼, 카드 안 인라인 링크) 또는 Regular(카드 위 역 이름)로 재배치. 버튼 라벨은 전 변형 Bold |
| 52/42/28px 헤딩, 자간 normal | **크기는 옮기지 않았다.** 1440px 마케팅 페이지 기준값이고, 이 앱은 480px 프레임 + 사용자가 2026-08-24에 두 차례 명시적으로 확정한 축소 스케일(12/13/14/16/19 + 40)을 갖고 있다. 리포지토리 사실이 참고 자료를 이긴다. **자간만** 가져왔다 — `ui.title`의 `letter-spacing: -0.02em` 제거 |

예외로 남긴 자간 세 곳: 워드마크 `0.18em`(로고타입 — 넓은 자간 자체가 브랜드 형태),
초대 코드 `0.08em`/`0.24em`(0과 O를 갈라 읽게 하는 기능적 자간).

### 2.4 상태

| 기아 레퍼런스 | 이 프로젝트 | 왜 그대로가 아닌가 |
|---|---|---|
| Disabled: 차콜 버튼을 `rgba(5,20,31,0.3)`로 페이드(회색 아님, 브랜드 톤 유지) | `--color-primary-disabled` = 라이트 `#697278`(Steel Grey) / 다크 `#79838b`(Steel Alt). 라벨은 채움 위 색 그대로 | **반투명을 불투명 합성값으로 못 박았다.** 차콜을 흰 배경에 60% 얹으면 정확히 Steel Grey가 나온다 — 기아의 페이드 의도를 그대로 재현하면서, 뒤 배경에 따라 라벨 대비가 흔들리는 상황을 없앤다. 결과 대비는 라이트 4.91:1 / 다크 4.82:1로 **고정**된다 |
| 로딩 스켈레톤: `#f8f8f8` 블록, shimmer 없음(플랫) | 모든 스켈레톤이 `--color-surface-muted` 플랫 블록. 기록 카드 이미지 시트의 sweep 애니메이션도 제거 | sweep이 있던 이유("만드는 중"과 "빈 상자" 구분)는 **매트 배경을 서피스로 올려 색 대비로 해결**했다. 진행 상황은 원래도 `role="status"` 문구(`.live`)가 전달한다 |
| 에러: 필드 하단 텍스트, `#05141f`, 담백한 설명체 | `--color-danger` = 차콜. `.error`(필드 하단), `.errorBanner`(폼 상단) 그대로 | 이미 같은 구조였다. 값만 순검정 → 차콜 |
| 성공: 차분한 확인 문구, 컨페티 없음 | `AppShell .toast` — 차콜 채움 + 각진 모서리, 애니메이션 없음 | 원래 컨페티류가 없었다. 알약 → 사각으로만 바뀜 |

---

## 3. 건드리지 않은 것과 그 근거 (예외 처리)

판단 기준은 하나다: **"이 색이 없어지면 사용자가 정보를 잃는가?"** 잃으면 유지, 순수 장식이면 대상.

| 대상 | 판단 | 근거 |
|---|---|---|
| 지하철 노선 색 `--line-*`, `--line-default` | **유지** | 실제 노선을 구분하는 기능적 정보다. 노선도 SVG·역 심볼 채움·호선 배지 점이 전부 이 값을 읽는다. 모노크롬 규칙을 여기 적용하면 2호선과 3호선이 같은 색이 된다 |
| ↳ **2026-08-31 확장** — 노선색 토큰이 `--line-2` 하나뿐이던 걸 MVP 24개 노선 전부로 확장 | **예외 영역 그대로** | 실색 토큰이 하나뿐이라 나머지 노선이 전부 `--line-default`(회색)로 떨어져 노선도가 통짜 회색으로 보이던 문제를 해소했다. 값은 국가철도공단·서울교통공사 CI 기반 **공식 색 그대로** — 모노크롬 브랜드 규칙과 무관하다. 다크 값은 "휘도 0.30 미만이면 각 채널 +44"(기존 `--line-2` 전례) 공식으로 기계 산출. 토큰 목록·구분성 검증은 `docs/design/system.md` §2 |
| 감정 😊😍😆😌😢 · 날씨 ☀️☁️🌧️❄️🌬️ 이모지 | **유지** | 색상 시스템 밖의 문자다. 형태 자체로 구분되고, 선택 상태는 색이 아니라 테두리 두께 + 글자 굵기(`.toggleOn`)가 알린다 |
| 프로필 추천 칩의 노선색 파스텔 배경(`--chip-line-color` 기반 `color-mix` 12%/20%) | **유지** | 노선 식별이 목적이다. 다만 배경 토큰이 바뀌었으므로 **대비를 재계산했다** — §4 참고. 결과적으로 여유가 늘었다 |
| 역 심볼 채움 농도(`color-mix`로 노선색 ↔ 서피스/텍스트 혼합, F-03) | **유지** | 방문 빈도를 인코딩하는 데이터 시각화다. 혼합 대상이 `--color-text`(순검정 → 차콜)로 바뀌었지만 상대휘도 차이가 0.0044로 무시 가능하다 |
| 기록 카드 PNG의 레이아웃·조판(`record-image-render.ts`의 치수 상수) | **유지** | `docs/design/record-card-review.md`가 확정한 별도 스펙이고, 저장된 이미지의 비율·좌표가 바뀌면 기존 결과물과 어긋난다. **색만** 브랜드에 맞췄다(순검정 → `--charcoal`, 스크림 `rgb(0 0 0/62%)` → `rgb(5 20 31/62%)`) |
| 타이포 **크기** 스케일 | **유지** | 사용자가 2026-08-24에 두 차례 명시적으로 확정("더 작게" ×2, "12px 밑으로는 내리지 마라") |

---

## 4. 접근성 재계산 (WCAG 2.1, 상대휘도 직접 계산)

팔레트가 통째로 바뀌었으므로 눈으로 판단하지 않고 전부 다시 계산했다.

| 조합 | 라이트 | 다크 | 기준 |
|---|---|---|---|
| `--color-text` / `--color-bg` | 18.65 | 19.49 | 4.5 |
| `--color-text-muted` / `--color-bg` | 10.16 | 10.50 | 4.5 |
| `--color-text-subtle` / `--color-bg` (비활성 탭) | 4.91 | 6.76 | 4.5 |
| `--color-text` / `--color-field` (입력 글자) | 17.56 | 16.03 | 4.5 |
| `--color-text-muted` / `--color-surface-muted` | 9.57 | 8.64 | 4.5 |
| `--color-text-inverse` / `--color-primary` (채움 버튼 라벨) | 18.65 | 18.65 | 4.5 |
| `--color-text-inverse` / `--color-primary-disabled` (비활성 라벨) | **4.91** | **4.82** | 4.5 |
| `--color-border-strong` / `--color-surface` (컨트롤 경계) | 4.91 | 4.82 | 3.0 |
| `--color-border-strong` / `--color-field` | 4.62 | 4.15 | 3.0 |
| `--color-focus` / `--color-bg` (포커스 링) | 18.65 | 19.49 | 3.0 |
| `--color-danger` / `--color-danger-soft` (에러 배너 글자·링크) | 17.56 | 16.03 | 4.5 |
| `--line-*` / `--color-bg` (노선 스트로크·역 심볼 테두리, 24색 최저) | 1.50 | 3.76 | 3.0 |
| 추천 칩 `.chipLine`(12px) / 노선색 12% 배경 (24색 최저) | 8.19 | 7.49 | 4.5 |
| 추천 칩 `.chipLine`(12px) / 노선색 20% hover 배경 (24색 최저) | **7.04** | **5.76** | 4.5 |

- 가장 타이트한 지점은 비활성 채움 버튼 라벨(4.82)과 입력 테두리(4.15)다. 둘 다 기준 위다.
- **추천 칩의 여유가 크게 늘었다**(다크 hover 4.97 → 5.76, 노선색 24개 전부 대입한 최저값).
  `--color-text-muted`가 밝아지고 서피스가 어두워진 덕이다. 비율을 12/20보다 진하게 올릴
  때는 24색 전부로 재계산한다.
- **노선 스트로크는 라이트에서 3:1을 못 채우는 색이 11개 있다**(최저 자기부상 1.50).
  공식 노선색이라 색으로는 못 고친다 — 형태(헤어라인)로 푸는 별도 과제다. 자세한 목록과
  근거는 `docs/design/system.md` §2 "노선 색 `--line-*`". 다크는 전부 3.76:1 이상이다.

### 접근성 관점에서 레퍼런스를 그대로 따르지 않은 두 곳

1. **Disabled를 `rgba(…, 0.3)` 반투명으로 두지 않았다**(§2.4). 반투명 채움 위 라벨은 뒤 배경에
   따라 대비가 흔들린다 — 우리 §5 규칙이 금지하는 상황이고, WCAG 1.4.3이 disabled를 면제한다는
   이유로 넘어갈 문제가 아니라고 봤다. 불투명 합성값을 쓰면 브랜드 의도(브랜드 색 페이드)와
   계산 가능한 대비를 둘 다 지킨다.
2. **포커스 링을 없애지 않았다.** 기아 레퍼런스에 포커스 상태 기술이 없지만, 없다고 지우지
   않는다 — `index.css`의 `:focus-visible`(2px `--color-focus`, offset 2px)이 그대로다.
   각진 컨트롤이라 오히려 링이 더 또렷하게 붙는다.

추가로, 재브랜딩 중 **기존 결함 하나를 같이 고쳤다**: 전체화면 사진 뷰어의 닫기·이전/다음·장수
표시가 `--color-text-inverse`를 쓰고 있어서 **다크 테마에서 어두운 스크림 위 어두운 글자**가 됐다
(라이트에서만 우연히 흰색이라 맞았다). 테마와 무관하게 항상 흰색인 `--color-on-scrim`을 새로
두고, 스크림 바닥도 리터럴 `rgb(0 0 0 / 40%)` 세 곳 → `--color-scrim` 토큰으로 옮겼다.

---

## 5. 컴포넌트 비주얼 스펙 (상태 · 치수 · 반응형)

### 5.1 Button (`src/components/ui/button.tsx`)

공통: `min-height 48px`, `padding 0 24px`, `border-radius 0`, 라벨 Bold, 밑줄 없음,
`transition: background-color/border-color/color 150ms`, `prefers-reduced-motion`에서 transition 제거.
**이동(transform)·그림자 효과 없음** — 재브랜딩으로 전부 제거돼 끌 모션 자체가 없다.

| 변형 | 기본 | hover | focus | disabled |
|---|---|---|---|---|
| `default`(채움, 주 동작) | 차콜 채움 + 흰 라벨 | 배경 `--color-primary-hover`(`#2a3a45` / 다크 `#dadce0`) | 공통 포커스 링 | 채움 `--color-primary-disabled`, 라벨 유지(4.91/4.82:1), `cursor: not-allowed`, 포인터 이벤트 차단 |
| `outline`(기본값, 보조) | 서피스 + `--color-border-strong` 1px + 본문색 | 배경 `--color-surface-muted` | 〃 | 배경 muted + `--color-text-muted` |
| `destructive`(파괴적) | 서피스 + danger 1px 윤곽 + danger 글자 | **채움으로 전환**(danger 배경 + 반전 글자) — 색이 아니라 형태가 위험을 알린다 | 〃 | outline과 동일 |

로딩은 버튼 스타일이 아니라 **라벨 교체**로 표현한다(`로그인` → `로그인하는 중…`) + `disabled`.
스피너를 새로 만들지 않았다 — 레퍼런스에 없고, 문구가 이미 상태를 말한다.

### 5.2 카드 (`ui.card`, `RecordCard.card`)

- 치수: 반경 15px, 패딩 24px(`ui.card`) / 12px(`RecordCard`), 테두리 1px `--color-border`.
- 상태: `RecordCard`는 카드 전체가 링크다 — hover에서 배경만 `--color-surface-muted`로 바뀐다
  (이동·그림자 없음). 밑줄은 끈다(형태가 이미 클릭 대상임을 알린다).
- 로딩: 같은 자리 같은 반경(15px)의 `--color-surface-muted` 플랫 블록. 실루엣이 달라지면
  도착하는 순간 형태가 튄다.
- 반응형: 카드 자체는 폭 100%. `<768px` 풀블리드, `≥768px`은 480px 앱 프레임 안.

### 5.3 입력 (`Input`/`Textarea`/`ui.input`)

반경 0, 최소 높이 48px, 패딩 12/16px, 바닥 `--color-field`, 테두리 1px `--color-border-strong`.
hover·focus에서 바닥이 `--color-surface`로 떠오르고 focus는 테두리를 `--color-primary`로 바꾼다
(포커스 링을 **대체**하는 게 아니라 보태는 신호다). 에러는 `aria-invalid` + 바닥 틴트 + **문구**,
비활성은 **파선 테두리** + muted 글자 — 셋 다 색 외 단서를 함께 준다.

### 5.4 칩 · 태그 · 탭

- 칩/태그: 반경 0, 최소 높이 44px(터치 타깃), 선택 상태는 `--color-primary` 채움 + 반전 글자.
- 탭바: 비활성 `--color-text-subtle`(Steel Grey), 활성 `--color-primary` + Bold + 상단 2px
  인디케이터 바 — 색 하나에 기대지 않는다.

### 5.5 반응형 브레이크포인트

| 폭 | 동작 |
|---|---|
| `<768px` | 풀블리드. 배경 = `--color-bg`(흰색/최심부 차콜). 워시·그라디언트 없음 |
| `≥768px` | 480px 프레임 카드(반경 15px, 1px 경계) + 단색 백드롭. 프레임이 스크롤 컨테이너 |
| `≥768px` 세로 | 프레임 최대 높이 900px |

---

## 6. 다음 사람이 알아야 할 것

1. **`--shadow-*`는 없다.** 그림자를 다시 넣고 싶어지면 그건 대비 설계가 부족하다는 신호다 —
   테두리(`--color-border` / 지도·캔버스 위라면 `--color-border-strong`)로 해결한다.
2. **`--radius-pill`도 없다.** `rounded-full`(Tailwind)은 이제 `--radius-circle`(50%)을 가리키고,
   진짜 원형 도형에만 쓴다. 알약 버튼을 만들지 않는다.
3. **굵기는 두 단계뿐이다.** 500이 필요해 보이면 그 자리는 제목(700)이거나 본문(400)이다.
4. **새 노선 색 토큰을 추가할 때** 추천 칩(12%/20%)과 역 심볼 농도(F-03) 대비를 재계산한다.
   여유는 넉넉해졌지만(§4) 규칙은 살아 있다.
5. **`.dark` 클래스 블록은 `@media (prefers-color-scheme: dark)`와 값이 한 글자도 달라선 안 된다.**
   지금은 OS 설정만 유효하고 `.dark`를 켜는 UI는 없다.
