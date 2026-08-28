# 인증 화면 · 폼 프리미티브 비주얼 스펙

구현: `src/styles/ui.module.css`, `src/components/Wordmark.tsx`,
버튼은 `src/components/ui/button.tsx`(shadcn) — §4 참고
토큰: `src/styles/tokens.css` / 규칙: `docs/design/system.md` / 프레임: `docs/design/app-frame.md`
근거: `docs/design/revision-2026-08-12-auth-frame.md` (1차 결과에 대한 수정 지시)

여기 정의한 프리미티브는 공용이다. `.screen` / `.form` / `.input` / `<Button>`을 쓰는 화면
**전부**가 같이 바뀐다: 로그인, 가입, 비밀번호 재설정(요청·설정), 메일 확인, 인증 콜백,
온보딩, 초대, 커플 연결 완료, 프로필, 자리표시자.

---

## 1. 화면 골격 (`.screen`)

```
┌─ 프레임 안쪽 ─────────────────────────┐
│▒▒▒▒ 브랜드 워시 (상단 200px, 페이드) ▒▒│
│  ↕ 32                                 │
│  ● 동네 발자취          ← .brand      │
│  ↕ 24                                 │
│  제목                   ← .title      │
│  ↕ 8                                  │
│  부제                   ← .subtitle   │
│  ↕ 40 (screen gap 24 + header pb 16)  │
│  [폼]                   ← .form       │
│  ↕ 24                                 │
│  ─────────────────                    │
│  ↕ 24   보조 링크        ← .linkRow   │
│  ↕ 48 (padding-bottom)                │
│  (남는 공간)                          │
└───────────────────────────────────────┘
```

| 속성 | 값 |
|---|---|
| 정렬 | `flex-start` (상단 정박) |
| 패딩 | `32px 24px 48px` |
| 자식 간격 | `24px` |
| 최대 폭 | `--content-max-width` (560px) — 프레임(480px) 안에서는 프레임 폭이 실질 제한 |
| 배경 | `--app-screen-wash`, `no-repeat`, `100% 200px` |

`.screenHeader`는 워드마크·제목·부제를 한 덩어리로 묶고 `padding-bottom: 16px`을 더한다.
헤더와 본문 사이만 40px로 벌어져 "여기부터 입력"이 읽힌다.

---

## 2. 워드마크 (`.brand` / `Wordmark`)

| | |
|---|---|
| 글자 | 14px / 700 / 자간 `0.18em` / `--color-text` / 행간 1.25 |
| 마크 | 16×16, 대각선 원 2개(7px), `--color-primary`, 뒤쪽 `opacity: .5`, `aria-hidden` |
| 간격 | 마크–글자 8px, 아래 24px |
| 상태 | 없음 (비대화형) |

글자에 브랜드색을 쓰지 않는다. 워시 위에서 4.2:1로 대비 미달이다 (system.md §2).

---

## 3. 입력 (`.input`)

| 상태 | 바닥 | 테두리 | 그 외 |
|---|---|---|---|
| 기본 | `--color-field` | 1px `--color-border-strong` | 높이 min 48px(실측 51.6), 패딩 12/16, 반경 12 |
| hover | `--color-surface` | 동일 | 바닥이 떠오른다 |
| focus | `--color-surface` | 1px `--color-primary` | + 전역 `:focus-visible` 링(2px `--color-focus`, offset 2) |
| 에러 (`aria-invalid="true"`) | `--color-danger-soft` | 1px `--color-danger` | 화면이 `.error` 문구를 함께 띄운다 |
| 비활성 | `--color-surface-muted` | 1px **파선** `--color-border-strong` | 글자 muted, `cursor: not-allowed` |
| 전환 | 배경·테두리 140ms ease | | |

- 포커스 링은 지우지 않는다. 테두리 색 변화는 링을 **보태는** 것이다.
- 텍스트 입력은 마우스 클릭에도 `:focus-visible`이 걸리므로 링이 항상 뜬다. 의도한 것이다.
- `.codeInput`은 `.input`에 고정폭·자간 `0.24em`·대문자 변환을 얹은 변형이다 (01 §6).

---

## 4. 버튼 — shadcn `<Button>` (`src/components/ui/button.tsx`)

> **`ui.module.css`의 `.button` / `.buttonPrimary` / `.buttonDanger`는 더 이상 없다.**
> shadcn/ui 마이그레이션(커밋 `0baeaf7`)에서 세 클래스를 지우고 `<Button>` 프리미티브
> 한 개 + `variant` 3종으로 옮겼다. 화면 코드는 전부 `<Button>`을 쓴다. 이 절의 값은
> Tailwind 유틸리티로 적혀 있지만 색·반경·높이는 `tailwind.config.ts`를 거쳐 그대로
> tokens.css 변수를 가리킨다 — 리터럴은 없다.
>
> | 옛 클래스 | 지금 |
> |---|---|
> | `.button` (보조) | `<Button>` (기본값 `variant="outline"`) |
> | `.buttonPrimary` (주 동작) | `<Button variant="default">` |
> | `.buttonDanger` (파괴적) | `<Button variant="destructive">` |
>
> `.buttonRow`(버튼 **줄 레이아웃**)만 `ui.module.css`에 남아 있다 — 버튼 스타일이 아니다.

공통(cva base): `inline-flex` 중앙 정렬, `min-h-control`(48px, 실측 51.6), 좌우 패딩 20,
반경 `rounded-md`(12), 굵기 500, `no-underline`(asChild로 `<a>`를 감쌀 때 전역 링크
밑줄을 끈다), 전환 150ms ease-out(배경·테두리·그림자·transform).

| 상태 | `outline` (기본값) | `default` (주 동작) | `destructive` (파괴적) |
|---|---|---|---|
| 기본 | `--color-surface`(card) 바닥 + 1px `--color-border-strong`(input) 테두리, 글자 `--color-text` | `--color-primary` 채움, 투명 테두리, `--shadow-button`, 굵기 700, 글자 `--color-text-inverse` | card 바닥 + 1px `--color-danger` 테두리·글자 |
| hover | `--color-surface-muted`(secondary) | `--color-primary-hover` + `--shadow-button-hover` + `translateY(-1px)` | `--color-danger-hover` 채움 + 역상 글자 |
| active | `translateY(1px)` | `translateY(1px)` + 그림자 원위치 | `translateY(1px)` |
| focus | 전역 `:focus-visible` 링 | 전역 링 | 전역 링 |
| 비활성 | secondary 바닥 + input 테두리 + muted 글자, 포인터 이벤트 차단 | 바닥만 `--color-primary-soft`, muted 글자, 그림자·이동 제거 | outline 비활성과 동일(테두리가 input으로 내려앉아 "지금은 위험 동작 아님"이 읽힌다) |
| 로딩 | — | 비활성 스타일 + 라벨 교체(`로그인하는 중…`) | — |

- **`opacity`로 흐리지 않는다.** 반투명 위 글자는 대비가 계산 불가능해진다. 채움을 걷어내고
  글자를 muted로 내리면 읽히면서도 비활성으로 읽힌다.
- `default`와 `destructive`는 **색이 같다**(둘 다 검정/흰색). 구분은 색이 아니라
  **채움 vs 윤곽**이라는 형태다 — system.md §2 "채움 vs 윤곽".
- 로딩은 별도 시각 요소(스피너) 없이 **라벨 교체 + 비활성 스타일**로 표현한다. 각 화면이
  이미 문구를 바꾸고 있고, 스피너를 넣으려면 상태 API가 필요해 개발자 영역이 된다.
- 그림자는 `default`에만 붙인다. "높이 = 주 동작"이 이 화면의 유일한 위계 신호다.
- 이동(`translateY`)은 장식이라 `motion-reduce:`로 끈다.

---

## 5. 배너 · 보조 텍스트

| 클래스 | 스펙 |
|---|---|
| `.errorBanner` | danger-soft 바닥 + 1px danger 테두리, 패딩 12/16, 반경 12, 글자 danger. **안쪽 링크는 danger + 굵기 700 + 밑줄 두께 2px**(offset 3) — 링크와 본문이 같은 색이라 굵기·밑줄이 유일한 구분 단서다 (WCAG 1.4.1). 대비: danger-soft 위 라이트 19.3:1 / 다크 15.1:1 |
| `.error` | 14px danger. 필드 바로 아래 |
| `.hint` | 12px muted |
| `.notice` | amber 바닥 + amber 테두리, 패딩 12/16, 반경 12 |
| `.linkRow` | 상단 1px `--color-border` 헤어라인 + `padding-top: 24px`, 중앙 정렬, 링크 간격 16px. 링크는 `min-height: 44px`(터치 타깃) + 밑줄 유지(offset 4px) |

---

## 6. 반응형

브레이크포인트는 프레임의 **768px 하나**뿐이다. `.screen` 자체는 폭에 따라 분기하지 않는다 —
데스크톱에서도 480px 프레임 안에 들어가므로 모바일과 같은 조판이면 충분하다.

| | <768px (mobile) | ≥768px (tablet/desktop) |
|---|---|---|
| 화면 폭 | 뷰포트 전체 (풀블리드) | 프레임 480px |
| 좌우 패딩 | 24px | 24px (동일) |
| 브랜드 워시 | 뷰포트 상단에 그대로 보인다 ← 모바일 브랜드 톤의 유일한 담당 | 프레임 상단, 백드롭 그라디언트와 이어진다 |
| 남는 세로 공간 | 콘텐츠 아래 (뷰포트 나머지) | 콘텐츠 아래 (프레임 나머지) |
| 스크롤 컨테이너 | 뷰포트 | 프레임 |

---

## 7. 렌더 검증 기록 (2026-08-12, Chrome 헤드리스 실측)

`/login` 기준, 라이트·다크 × 375 / 768 / 1280.

- 상단 정렬: `h1`이 프레임 상단에서 73.5px(=패딩 32 + 워드마크 21 + 여백 24). 중앙 정렬 때
  생기던 폼 위 빈 공간 사라짐.
- 입력·버튼 실측 높이 51.6px, `.linkRow` 링크 실측 44px — 터치 타깃 통과.
- 계산된 값 확인: 입력 바닥 `rgb(246,242,243)`, 테두리 `rgb(142,132,137)`, 반경 12px,
  `.screen`의 `justify-content: flex-start`.
- 가로 오버플로 없음(3폭 전부 `scrollWidth === clientWidth`).
- 상태 렌더 확인: 기본(비활성 버튼) / 입력됨(활성 버튼) / primary hover / 입력 focus /
  가입 화면 에러(2필드) / 메일 확인 화면(notice + 비활성 secondary).
- 다크 버튼 글로우는 1차 값(55%)이 네온처럼 번져 38%로 내렸다 — 렌더 보고 고친 값이다.
