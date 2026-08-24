# 디자인 시스템 — 동네 발자취

구현: `src/styles/tokens.css` (단일 소스). 컴포넌트 CSS는 여기 시맨틱 토큰만 참조한다.

톤: 커플 전용 아카이브. **흑백 심플모던**(2026-08-19 개편, 커밋 `064a2a0`)이 현재 기준이다.
아래 이 문서는 그 개편 당시 갱신되지 않고 방치돼 있던 웜 로즈 팔레트 표를 2026-08-21에
`tokens.css`의 실제 그레이스케일 값으로 다시 맞췄다 — **이 문서가 tokens.css와 다른 값을
보여주고 있었다면 그건 문서의 지연이었지, 새 결정이 아니다.** 감성적이되 대비는 계산해서
지킨다는 원칙 자체는 로즈 시절과 동일하게 유지된다.

---

## 1. 레이어 구조

```
원시 팔레트  --rose-* --peach-* --sand-* --ink-* --coral-* --amber-* --blue-*
      │  (이 이름을 컴포넌트에서 직접 쓰지 않는다 — 다크 전환이 깨진다)
      ▼
시맨틱 토큰  --color-* --app-* --shadow-* --space-* --radius-* --font-*
      │
      ▼
컴포넌트 CSS (*.module.css)
```

라이트가 `:root` 기본값, 다크는 `@media (prefers-color-scheme: dark)`에서 **시맨틱 토큰만**
덮어쓴다. 앱 내 테마 토글은 아직 없다.

---

## 2. 색 — 시맨틱 토큰

흑백 심플모던(2026-08-19) 이후 원시 팔레트는 그레이스케일 램프 하나뿐이다. 아래 표는
`tokens.css`의 실제 값(2026-08-21 갱신, 웜 로즈 시절 표가 방치돼 있던 걸 바로잡음)이다.

| 토큰 | 라이트 | 다크 | 쓰는 곳 | 쓰면 안 되는 곳 |
|---|---|---|---|---|
| `--color-bg` | `#fafafa`(gray-50) | `#000000`(black) | 앱 바탕(=프레임 안쪽), body | 카드/입력 배경 (서피스가 사라진다) |
| `--color-surface` | `#ffffff`(white) | `#171717`(gray-900) | 카드, 탭바, 다이얼로그, 입력의 hover/focus 바닥 | 넓은 화면 바탕 |
| `--color-surface-muted` | `#f5f5f5`(gray-100) | `#262626`(gray-800) | disabled 컨트롤 바닥, 버튼 hover | 텍스트 위 오버레이 |
| `--color-field` | `#ededed`(gray-150) | `#262626`(gray-800) | 입력 필드 기본 바닥 | 버튼·카드 (입력이 아닌 것에 쓰면 신호가 흐려진다) |
| `--color-border` | `#e5e5e5`(gray-200) | `#262626`(gray-800) | 카드 테두리, 구분선 | 입력 테두리(약해서 3:1 미달) |
| `--color-border-strong` | `#737373`(gray-500) | `#737373`(gray-500) | 입력·버튼 테두리, 스크롤바 | 장식용 헤어라인(너무 진하다 — `--color-hairline` 참고) |
| `--color-hairline` | `rgb(0 0 0 / 12%)` | `rgb(255 255 255 / 14%)` | **불투명 서피스 위**의 카드·다이얼로그·열린 메뉴 장식 경계(2026-08-21, Resend 참고) | 지도/노선도·카카오맵 위 컨트롤(배경 예측 불가) — 그 자리는 `--color-surface` 불투명만 |
| `--color-text` | `#000000`(black) | `#ffffff`(white) | 본문·제목 | primary/danger 배경 위 |
| `--color-text-muted` | `#525252`(gray-600) | `#a3a3a3`(gray-400) | 보조 설명, 비활성 탭 라벨 | 12px 미만 텍스트, 에러 문구 |
| `--color-text-inverse` | `#ffffff`(white) | `#000000`(black) | primary/danger **배경 위** 글자 | 그 외 전부 (다크에서 값이 뒤집힌다) |
| `--color-primary` | `#000000`(black) | `#ffffff`(white) | 링크, 기본 버튼 배경, 활성 탭 | 큰 면적 바탕(그 자리는 `--color-bg`) |
| `--color-primary-hover` | `#262626`(gray-800) | `#e5e5e5`(gray-200) | 기본 버튼 hover | 기본 상태 |
| `--color-primary-soft` | `#f5f5f5`(gray-100) | `#262626`(gray-800) | 선택된 칩/셀 배경 | 텍스트 색 |
| `--color-danger` | `#000000`(black) | `#ffffff`(white) | 에러 문구, 위험 버튼 테두리 | 일반 강조 — primary와 같은 색이므로 **채움/윤곽 형태로만** 구분(§5) |
| `--color-danger-soft` | `#f5f5f5`(gray-100) | `#262626`(gray-800) | 에러 배너 배경 | 단독 사용(테두리 없이) |
| `--color-notice-bg` / `-border` | `#f5f5f5` / `#d4d4d4` | `#262626` / `#525252` | 안내 배너("상대 초대 대기 중") | 에러 |
| `--color-focus` | `#000000`(black) | `#ffffff`(white) | `:focus-visible` 아웃라인 전용 | 링크·강조색(지금은 primary와 같은 색이라 혼동 위험이 낮다) |
| `--color-overlay` | `rgb(0 0 0 / 55%)` | `rgb(0 0 0 / 70%)` | 모달 딤 | 콘텐츠 위 텍스트 배경 |

### 검증된 대비 (계산값, WCAG 2.1 — 그레이스케일 상대휘도 기준 재계산)

| 조합 | 라이트 | 다크 | 기준 |
|---|---|---|---|
| `--color-text` / `--color-bg` | 20.1 | 21.0 | 4.5 |
| `--color-text-muted` / `--color-bg` | 7.5 | 8.3 | 4.5 |
| `--color-primary` / `--color-bg` (링크·버튼 배경) | 20.1 | 21.0 | 4.5 |
| `--color-text-inverse` / `--color-primary` (버튼 글자) | 21.0 | 21.0 | 4.5 |
| `--color-danger` / `--color-bg` | 20.1 | 21.0 | 4.5 |
| `--color-focus` / `--color-bg` | 20.1 | 21.0 | 3.0 |
| `--color-text` / `--color-field` (입력 글자) | 17.9 | 15.1 | 4.5 |
| `--color-border-strong` / `--color-surface` | 4.7 | 3.8 | 3.0 |
| `--color-border-strong` / `--color-field` | 4.0 | 3.2 | 3.0 |
| `--color-text-muted` / `--color-primary-soft` (disabled 버튼) | 5.2 | 6.4 | 4.5 |
| `--color-danger` / `--color-danger-soft` (배너 글자·링크) | 20.1 | 21.0 | 4.5 |

> primary와 danger가 같은 색(검정/흰색)인 것은 §5(접근성)의 "채움 vs 윤곽" 규칙과 짝을 이룬다.
> 색으로 구분하지 않으므로 대비표에는 같은 숫자가 반복되지만, 실제 구분은 형태가 한다.

> **에러 배너 안의 링크는 `--color-danger`를 쓴다.** 지금은 `--color-primary`와 값이 같아
> 실질적으로 문제되지 않지만, 두 토큰의 용도가 갈릴 가능성을 대비해 `.errorBanner a`가
> 여전히 `--color-danger`를 강제한다 — 로즈 시절(원래 이 규칙이 생긴 이유)의 잔재 규칙을
> 그대로 유지했다.

### 대비를 보장하지 못하는 구간 — 그레이스케일 전환으로 사실상 해소됨

로즈 시절에는 `--app-screen-wash`(브랜드색 그라디언트) 위에서 `--color-primary`(로즈) 텍스트가
4.2:1로 미달하는 구간이 있었다. 지금 `--app-screen-wash`는 무채색 명암 텍스처(`rgb(0 0 0 / 4%)`
→ 투명, 다크는 흰색 방향)이고 `--color-primary`도 흑백(위 표)이라 **색상 간섭 자체가 없다** —
워시가 진하게 깔려도 텍스트는 명도만 오갈 뿐 채도 충돌이 없으므로 이 구간의 미달 사례는
재계산해도 나오지 않는다. 다만 워시 위에 텍스트를 얹는 관행 자체(브랜드 존중용 여백)는
유지한다 — 자기 배경을 가진 강조 요소(`.errorBanner`, `.notice`)만 얹는 원칙도 그대로다.

---

## 3. 앱 프레임 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `--app-backdrop` | 그레이 워시 그라디언트 (다크: 근-검정) | ≥768px에서 프레임 바깥 배경 |
| `--app-frame-width` | `480px` | 프레임 고정 폭 |
| `--app-frame-max-height` | `900px` | 초대형 모니터에서 세로로 늘어지는 것 방지 |
| `--app-frame-radius` | `28px` | 프레임 모서리 |
| `--app-frame-border` | 검정 8% / 흰 10% | 프레임 외곽 1px |
| `--shadow-frame` | 2단 그림자 | 프레임 부양감 |
| `--app-screen-wash` | 검정 4%→0% 그라디언트 (다크: 흰 6%→0%) | `.screen` 상단 명암 밴드(브랜드색 없음, §2 참고) |
| `--app-screen-wash-height` | `200px` | 워시가 사라지는 지점 = 헤더 블록 높이 |

`--app-screen-wash`는 **모바일 대책**이다. `<768px`에서는 프레임 백드롭이 아예 안 보여서
데스크톱만 브랜드 톤을 갖고 모바일이 더 밋밋해지는 역전이 있었다. 워시는 뷰포트가 아니라
`.screen`에 붙으므로 두 환경 모두에서 똑같이 보인다.

자세한 동작은 `docs/design/app-frame.md`.

---

## 4. 간격 · 반경 · 타이포 · 그림자

- 간격: `--space-1..12` = 4·8·12·16·20·24·32·40·48px. 4px 배수 외의 값 금지.
- 반경: `--radius-sm/md/lg/pill` = 6/**12**/16/999px.
  (md를 10→12로 올렸다. 컨트롤 높이가 48px이라 10px는 각져 보이고, 프레임 28px과도 계열이 안 맞았다.)
- 타이포 6단계: `xs 12 / sm 14 / md 16 / lg 20 / xl 26` + `code 40`(초대 코드 전용,
  `--font-size-display`가 같은 40px을 가리키는 별칭 — 새 단계 아님, `tokens.css` 참고).
  굵기 3단계(400/500/700), 행간 2단계(1.25 / 1.6).
  자간은 토큰이 아니다 — 워드마크(`0.18em`)·제목(`-0.02em`)·초대 코드(`0.08em`)처럼
  용도가 하나뿐인 값이라 해당 클래스에 직접 쓴다.
  본문 서체는 `--font-sans`(Noto Sans KR)만 쓴다. `--font-numeric`(Inter 우선, 미설치 —
  §8 참고)은 날짜·통계 숫자처럼 라틴/숫자 비중이 큰 자리에만 제한적으로 쓴다.
- 컨트롤 치수: `--control-height` 48px(입력·버튼 공통 최소 높이),
  `--touch-target` 44px(WCAG 2.5.8 하한 — 링크·탭 등 높이를 따로 잡는 것들의 바닥선).
- 그림자 4단계: `--shadow-card` / `--shadow-dialog` / `--shadow-frame` /
  `--shadow-button`·`--shadow-button-hover`.
  `--shadow-button`은 **primary 버튼 전용**이다. 미니멀 방향에서 색을 더 늘리는 대신
  높이로 주 동작을 구분하려고 둔 것이라, 아무 데나 쓰면 그 구분이 무의미해진다.
  라이트는 중성 검정 그림자, 다크는 검정 그림자가 안 보이므로 흰색 글로우로 뒤집는다
  (`tokens.css` 상단 주석 — 로즈 시절 이 문서가 "로즈 글로우"라고 잘못 남아 있던 걸 정정).

---

## 5. 접근성 규칙

- 포커스 링은 `index.css`의 `:focus-visible` 한 곳에서만 정의한다.
  컴포넌트에서 `outline: none`을 쓰지 않는다. `.input:focus`가 테두리를 브랜드색으로 바꾸는 건
  포커스 링을 **대체**하는 게 아니라 보태는 것이다 (링은 그대로 바깥에 뜬다).
- 터치 타깃 최소 44×44px. 입력·버튼 `min-height: 48px`(실측 51.6px),
  `.linkRow` 안의 텍스트 링크도 `min-height: 44px`(실측 44px), 탭바 각 탭 실측 55px.
- 색만으로 상태를 알리지 않는다.
  - 활성 탭 = 색 + 굵기 + 상단 인디케이터 바
  - 입력 에러 = 테두리색 + 바닥 틴트 + **문구**(`.error`)
  - 입력 비활성 = 색 + **파선 테두리**
  - 버튼 비활성 = 채움 제거 + muted 글자 (opacity로 흐리지 않는다 — 반투명 검정/흰색 위
    글자는 대비가 무너진다)
- 링크는 밑줄을 유지한다(`index.css`의 `a`). 색만으로 링크임을 알리지 않는다.
- 이동·부양 효과(`transform`)는 `prefers-reduced-motion: reduce`에서 전부 끈다.
  색 변화만 남으므로 상태 구분은 유지된다.
- 지도/노선도 위에 얹히는 컨트롤은 반투명 금지. `--color-surface`(불투명)를 쓴다.
  `--app-screen-wash`는 이 규칙의 예외가 아니다 — 지도가 아니라 앱 바탕 위에만 깔리고,
  그 위 텍스트 대비를 §2에서 계산해 뒀다.
  **`--color-hairline`(2026-08-21 추가)도 이 규칙의 예외가 아니다** — 지도/노선도/카카오맵
  컨트롤에는 절대 쓰지 않는다. 이미 불투명한 서피스(카드·다이얼로그·열린 메뉴) 위의 장식
  경계로만 쓴다. 자세한 건 §8.

---

## 6. 브랜드

워드마크는 **텍스트 로고타입**이다 (`src/components/Wordmark.tsx`, `.brand`).
일러스트·캐릭터·장식 아이콘은 쓰지 않는다 — 미니멀 방향에서 위계는 타이포와 여백이 만든다.

- 글자: 서비스명 "동네 발자취", 14px / 700 / 자간 `0.18em` / `--color-text`.
  자간을 벌리는 것만으로 본문과 다른 층위로 읽힌다.
- 마크: 대각선으로 놓인 원 두 개 (발자국 추상화). `--color-primary`, 뒤 발자국은 `opacity: .5`.
  16×16 CSS 도형이라 에셋이 없다. 순수 장식이므로 `aria-hidden`.
- **미인증 화면에서만** 쓴다. 로그인 뒤에는 탭바가 정체성을 대신하므로 화면마다 반복하지 않는다.

---

## 7. 아직 정하지 않은 것 (placeholder)

`src/styles/tokens.css` 상단 주석과 동일하게 유지한다.

- **타이포 스케일** — 국문 서체는 Noto Sans KR로 확정됐지만(2026-08-19), 크기·행간 자체는
  여전히 임시값이다. 워드마크 자간(`0.18em`)도 마찬가지.
- **간격 스케일 정리** — `--space-10(40)` 사용처 확인 후 삭제 검토.
  (`--space-5(20)`는 `.form` 세로 간격·버튼 좌우 패딩으로 자리를 잡았다.)
- **노선 색상** — 실제 지하철 호선 색을 써야 하므로 `03-line-map` 스펙 확정 후.
- **감정·날씨 아이콘 / 방문·미방문 스탬프** — 정의 없음.
- **다크 모드 범위** — 프레임·배경·서피스·텍스트·상태색까지만 렌더 검증. 노선도 SVG,
  카카오맵 오버레이는 화면 자체가 없어 미검증.
- **`--font-numeric`(Inter) 미설치** — `@fontsource/inter` 추가 전까지는 시스템 폰트로
  폴백된다. §8 참고.
- **`.dark` 클래스 토글 미사용** — `tokens.css`에 shadcn 호환용으로 값은 넣어 뒀지만
  이 값을 켜는 UI(테마 스위처)는 없다. 지금은 OS 설정(`prefers-color-scheme`)만 유효하다.

---

## 8. Resend 레퍼런스 재구성 + shadcn/ui 준비 (2026-08-21)

사용자가 첨부한 Resend 마케팅 사이트 캡처 문서(`DESIGN.md`)를 참고해 shadcn/ui 도입을
준비했다. 판단 근거와 채택/기각 목록 전문은 `docs/design/redesign-resend-reference.md`.
여기는 이번 라운드로 `tokens.css`에 실제로 늘어난 토큰만 요약한다.

| 토큰 | 값(라이트/다크) | 용도 |
|---|---|---|
| `--color-hairline` | 검정 12% / 흰 14% | 불투명 서피스 위 장식 경계(카드·다이얼로그·열린 메뉴). 지도/노선도 위 컨트롤 금지(§5) |
| `--font-numeric` | `Inter, 'Noto Sans KR', …` | 날짜·통계 숫자 등 라틴/숫자 비중이 큰 자리. **미설치** — developer-frontend가 `@fontsource/inter` 추가해야 실제로 Inter가 뜬다 |
| `--font-size-display` | `var(--font-size-code)`(40px) | 초대 코드와 같은 40px을 재사용하는 별칭. 새 타이포 단계 아님 |
| `--background` `--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--muted` `--muted-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--border` `--input` `--ring` `--radius` | 기존 `--color-*`/`--radius-*`를 가리키는 별칭 | shadcn/ui 프리미티브가 기대하는 표준 변수명. 값의 출처는 항상 `--color-*`다 — 여기서 새 색을 정의하지 않는다 |

**핵심 판단 — Resend의 `#00a3ff`는 가져오지 않는다.** 2026-08-19 흑백 개편이 "강조는 색이
아니라 채움/윤곽 형태"로 이미 확정했고(§2), DESIGN.md 자신이 명시한 적용 우선순위
(사용자 지시 > 리포지토리 사실 > 그 문서 자신 > 참고 영감)로도 이 리포지토리의 확정 사실이
이긴다. `--secondary`와 `--accent`가 같은 중립 톤을 가리키는 것도 같은 이유다 — 이 앱에는
"악센트 색"이 없다.

**Domaine Display / ABC Favorit도 가져오지 않는다.** 둘 다 한글 글리프가 없는 라틴 전용
서체라 이 앱(전체 한글 UI)에 그대로 쓰면 시스템 폰트로 조용히 폴백된다. 대신 Noto Sans KR의
굵기(700)·자간(타이트하게)·크기로 같은 "에디토리얼 무게감"을 낸다 — `--font-size-display`가
그 실행 지점이다.

`--radius`는 shadcn 기본 테마의 `calc(var(--radius) - 2px)` 파생 공식을 쓰지 않는다. 이
프로젝트는 반경도 유한한 단계(`--radius-sm/md/lg/pill`)만 쓴다는 원칙이 있고, 이미 12px
(`--radius-md`)로 근거를 남기고 확정한 값이라(§4) Resend의 4px 프라이머리 CTA로 되돌리지
않는다. Tailwind 설정에서 `borderRadius`를 그 네 토큰에 직접 매핑하도록 developer-frontend에
넘긴다.

`.dark` 클래스 블록은 `@media (prefers-color-scheme: dark)`와 값이 완전히 같아야 하는
동기화 대상이다(`tokens.css` 주석 참고) — shadcn/ui가 보통 기대하는 수동 토글 경로를 위해
미리 넣어 뒀을 뿐, 지금 이 값을 켜는 UI는 없다.
