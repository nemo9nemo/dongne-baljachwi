# 디자인 시스템 — 동네 발자취

구현: `src/styles/tokens.css` (단일 소스). 컴포넌트 CSS는 여기 시맨틱 토큰만 참조한다.

**현재 기준: 기아 레퍼런스 재브랜딩(2026-08-31).** 차콜 네이비 모노크롬 · 각진 컨트롤 ·
15px 카드 · 그림자 없음 · 두 굵기 타이포. 판단 근거와 원본 값 매핑표 전문은
`docs/design/kia-reference-redesign.md`.

이전 방향 문서(`redesign-resend-reference.md`, 흑백 그레이스케일 + Resend 어휘)는 **폐기**됐고
히스토리로만 남아 있다. 그 문서의 토큰 값을 근거로 코드를 고치지 않는다.

계승된 원칙(팔레트가 바뀌어도 유지되는 것):
- 강조는 색이 아니라 **채움(필드) vs 윤곽(아웃라인)** 형태가 한다 — `--color-primary`와
  `--color-danger`가 같은 색인 이유(2026-08-19 확정).
- 대비는 눈이 아니라 계산으로 확인한다.
- 타이포 크기 스케일은 사용자가 두 차례 확정한 값이다(2026-08-24).

---

## 1. 레이어 구조

```
원시 팔레트  --white --charcoal --charcoal-deep --gray-50…950
      │  (이 이름을 컴포넌트에서 직접 쓰지 않는다 — 다크 전환이 깨진다)
      ▼
시맨틱 토큰  --color-* --app-* --space-* --radius-* --font-*
      │
      ▼
컴포넌트 CSS (*.module.css) / Tailwind(shadcn 별칭 경유)
```

라이트가 `:root` 기본값, 다크는 `@media (prefers-color-scheme: dark)`와 `.dark` 두 블록에서
**시맨틱 토큰만** 덮어쓴다(두 블록의 값은 항상 동일해야 한다). 앱 내 테마 토글은 아직 없다.

원시 팔레트의 여덟 고정점은 기아 레퍼런스의 명명된 색 그대로다:
`#05141f`(Primary) `#010e18`(Dark Surface) `#ffffff` `#f8f8f8`(Surface Grey)
`#dadce0`(Border Grey) `#37434b`(Body Slate) `#697278`(Steel Grey) `#79838b`(Steel Alt).
**순검정(`#000000`)은 이 시스템에 없다.**

---

## 2. 색 — 시맨틱 토큰

| 토큰 | 라이트 | 다크 | 쓰는 곳 | 쓰면 안 되는 곳 |
|---|---|---|---|---|
| `--color-bg` | `#ffffff` | `#010e18` | 앱 바탕(=프레임 안쪽), body | — |
| `--color-surface` | `#ffffff` | `#05141f` | 카드, 탭바, 다이얼로그, 입력의 hover/focus 바닥 | 라이트에선 bg와 같은 값이다 — 카드를 카드로 만드는 건 **테두리+반경**이지 이 색이 아니다 |
| `--color-surface-muted` | `#f8f8f8` | `#14232e` | 섹션 구분, hover 바닥, **로딩 스켈레톤**, 배지/칩 바탕 | 텍스트 위 오버레이 |
| `--color-field` | `#f8f8f8` | `#14232e` | 입력 필드 기본 바닥 | 버튼·카드 (입력이 아닌 것에 쓰면 신호가 흐려진다) |
| `--color-border` | `#dadce0` | `#2a3a45` | 카드 테두리, 구분선, 다이얼로그 경계 | 입력·버튼 테두리(약해서 3:1 미달), **지도/캔버스 위 요소** |
| `--color-border-strong` | `#697278` | `#79838b` | 입력·버튼 테두리, 지도/노선도 위 컨트롤·정보창·열린 메뉴, 스크롤바 | 카드 사이 구분선(너무 진하다) |
| `--color-text` | `#05141f` | `#ffffff` | 본문·제목 | primary/danger 채움 위 |
| `--color-text-muted` | `#37434b` | `#b9bfc4` | 보조 설명, 힌트, 배지 글자 | primary 채움 위 |
| `--color-text-subtle` | `#697278` | `#9299a0` | 3차 텍스트 — 비활성 탭 라벨처럼 "지금 활성이 아닌 것" | 본문, 에러 문구 |
| `--color-text-inverse` | `#ffffff` | `#05141f` | primary/danger **채움 위** 글자 | 그 외 전부. 특히 **어두운 스크림 위에 쓰지 말 것**(다크에서 뒤집힌다 — 그 자리는 `--color-on-scrim`) |
| `--color-primary` | `#05141f` | `#ffffff` | 링크, 채움 버튼 배경, 활성 탭, FAB, 토스트 채움 | 큰 면적 바탕 |
| `--color-primary-hover` | `#2a3a45` | `#dadce0` | 채움 버튼 hover | 기본 상태 |
| `--color-primary-soft` | `#f8f8f8` | `#14232e` | 선택된 셀/토글 배경 | 텍스트 색 |
| `--color-primary-disabled` | `#697278` | `#79838b` | **채움 버튼의 비활성 상태 배경** (브랜드 색 페이드의 불투명 합성값) | 활성 요소, 텍스트 |
| `--color-danger` | `#05141f` | `#ffffff` | 에러 문구, 위험 버튼 윤곽 | 일반 강조 — primary와 같은 색이므로 **채움/윤곽 형태로만** 구분(§5) |
| `--color-danger-soft` | `#f8f8f8` | `#14232e` | 에러 배너 배경 | 단독 사용(테두리 없이) |
| `--color-notice-bg` / `-border` | `#f8f8f8` / `#dadce0` | `#14232e` / `#2a3a45` | 안내 배너("상대 초대 대기 중") | 에러 |
| `--color-focus` | `#05141f` | `#ffffff` | `:focus-visible` 아웃라인 전용 | 링크·강조색 |
| `--color-overlay` | `rgb(5 20 31 / 55%)` | `rgb(1 14 24 / 78%)` | 모달 딤 | 콘텐츠 위 텍스트 배경 |
| `--color-scrim` | `rgb(5 20 31 / 62%)` | `rgb(1 14 24 / 70%)` | **사진 위** 컨트롤 바닥(전체화면 뷰어 버튼·장수 표시) | 앱 배경 위 요소(불투명 서피스를 쓴다) |
| `--color-on-scrim` | `#ffffff` | `#ffffff` | 스크림·딤 위 글자. **테마와 무관하게 항상 흰색** | 그 외 전부 |

### 검증된 대비 (계산값, WCAG 2.1)

| 조합 | 라이트 | 다크 | 기준 |
|---|---|---|---|
| `--color-text` / `--color-bg` | 18.65 | 19.49 | 4.5 |
| `--color-text-muted` / `--color-bg` | 10.16 | 10.50 | 4.5 |
| `--color-text-subtle` / `--color-bg` | 4.91 | 6.76 | 4.5 |
| `--color-text` / `--color-field` | 17.56 | 16.03 | 4.5 |
| `--color-text-muted` / `--color-surface-muted` | 9.57 | 8.64 | 4.5 |
| `--color-text-inverse` / `--color-primary` (채움 버튼 라벨) | 18.65 | 18.65 | 4.5 |
| `--color-text-inverse` / `--color-primary-disabled` (비활성 라벨) | 4.91 | 4.82 | 4.5 |
| `--color-border-strong` / `--color-surface` | 4.91 | 4.82 | 3.0 |
| `--color-border-strong` / `--color-field` | 4.62 | 4.15 | 3.0 |
| `--color-focus` / `--color-bg` | 18.65 | 19.49 | 3.0 |
| `--color-danger` / `--color-danger-soft` | 17.56 | 16.03 | 4.5 |
| `--line-2` / `--color-bg` (역 심볼 테두리) | 3.72 | 8.58 | 3.0 |

> primary와 danger가 같은 색인 것은 §5의 "채움 vs 윤곽" 규칙과 짝을 이룬다. 대비표에 같은
> 숫자가 반복되지만 실제 구분은 형태가 한다.

`--color-border`(카드 테두리)는 배경 대비가 1.4:1 안팎으로 낮다. **의도된 값이다** — 이건
컴포넌트를 식별하는 유일한 수단이 아니라 그룹을 나누는 구분선이고, 클릭 가능한 카드는 텍스트·
hover 배경 전환이 별도 단서를 준다. 컨트롤의 경계처럼 3:1이 필요한 자리는 `--color-border-strong`이다.

### 노선 색 파생 배경 — 프로필 추천 칩 (재브랜딩 예외 영역)

`ProfileScreen`의 "다음에 가볼만한 역" 칩(`profile.module.css` `.chip`)은 배경에 소속 노선 색의
파스텔톤을 쓴다. **노선 식별이 목적이므로 모노크롬 재브랜딩 대상이 아니다.**

- **컴포넌트 계약**: `.chip`이 인라인 커스텀 프로퍼티 `--chip-line-color`를 받는다.
  값은 `StationPicker.tsx` 배지 점과 같은 폴백 체인:
  `var(--{rec.lines[0].colorToken}, var(--line-default))`. 노선 정보가 없으면 스타일 자체를
  꽂지 않고, `color-mix`가 자기 자신으로 폴백해 서피스 그대로 떨어진다.
- **비율**: 기본 12%, hover 20%. `@supports (background: color-mix(...))`로 감싸 미지원
  브라우저(iOS Safari 16.0~16.1)는 미믹스 `--color-surface`를 쓴다.
- **대비 재계산 (2026-08-31, 새 팔레트 기준 / `--line-2`):**

  | 상태 | 비율 | `.chipLine`(12px, muted) 라이트 / 다크 | 기준 |
  |---|---|---|---|
  | 기본 | 12% | 9.4 / 9.6 | 4.5 |
  | hover | 20% | 7.97 / 7.05 | 4.5 |

  재브랜딩 전 가장 타이트하던 지점(다크 hover 4.97, 여유 0.47)이 **7.05로 넉넉해졌다** —
  muted가 밝아지고 서피스가 어두워진 덕이다. 그래도 **새 노선 색 토큰을 추가하면 이 비율의
  대비를 다시 계산한다**는 규칙은 유지한다.
- 칩 형태는 바뀌었다: 알약(999px) → 각진 사각형(`--radius-control`), 좌우 패딩 24px.

---

## 3. 앱 프레임 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `--app-backdrop` | `#f8f8f8` (다크 `#05141f`) | ≥768px에서 프레임 바깥 배경. **단색** — 그라디언트를 걷어냈다 |
| `--app-frame-width` | `480px` | 프레임 고정 폭 |
| `--app-frame-max-height` | `900px` | 초대형 모니터에서 세로로 늘어지는 것 방지 |
| `--app-frame-radius` | `var(--radius-card)`(15px) | 프레임 모서리 — 이 시스템에서 가장 큰 카드다(이전 28px 폐기) |
| `--app-frame-border` | `#dadce0` (다크 `#2a3a45`) | 프레임 외곽 1px |

**그림자 없이 뜨는 방법**: 프레임(흰색 / 다크는 최심부 차콜)과 백드롭(Surface Grey / 차콜)의
색 대비 + 1px 경계. 라이트는 프레임이 백드롭보다 밝고, 다크는 반대로 백드롭이 한 단계 밝다.

`--app-screen-wash`(상단 그라디언트 워시)는 **삭제**됐다. 이 시스템은 플랫이다 — 화면의 성격은
텍스처가 아니라 타이포 위계와 여백이 만든다. 자세한 프레임 동작은 `docs/design/app-frame.md`.

---

## 4. 간격 · 반경 · 타이포

- **간격**: `--space-1/2/3/4/6/8/12` = 4·8·12·16·24·32·48px. 이름의 숫자 × 4 = 값이다.
  스케일 밖의 20px(옛 `--space-5`)·40px(옛 `--space-10`)은 2026-08-31에 제거했다.
- **반경**: 역할 토큰 두 개가 전부다.
  - `--radius-control: 0px` — 버튼·입력·칩·태그·배너·메뉴·토스트·FAB·썸네일·섹션
  - `--radius-card: 15px` — **시스템에서 유일하게 둥근 요소.** 카드, 다이얼로그 3종, 앱 프레임,
    카드 자리를 대신하는 스켈레톤
  - `--radius-circle: 50%` — 진짜 원형 도형 전용(워드마크 발자국 점, 노선 색 점). 알약 아님
  - `--radius-sm/md`(=control), `--radius-lg`(=card)는 shadcn/Tailwind 호환용 별칭이다.
    새로 쓰는 CSS는 역할 토큰을 쓴다. `--radius-pill`은 **삭제**됐다.
- **그림자**: **없다.** `--shadow-*` 토큰이 존재하지 않고, 앱 전체 `box-shadow` 선언이 0개다.
  (유일한 예외는 `record-editor` `.toggleOn`의 `inset 0 0 0 1px` — 드롭 섀도가 아니라 선택
  상태의 테두리를 두껍게 만드는 장치다.) 깊이가 필요하면 배경 대비와 1px 경계로 낸다.
- **타이포 크기 6단계**(2026-08-24 사용자 확정, 재브랜딩에서 손대지 않음):
  `xs 12 / sm 13 / md 14 / lg 16 / xl 19` + `code 40`(`--font-size-display`가 같은 40px 별칭).
  12px는 하한선이다 — 사용자가 "12px 밑으로는 내리지 마라"로 명시 확인했다.
- **굵기 2단계**: `--font-weight-regular: 400` / `--font-weight-bold: 700`.
  Bold = 헤딩·제목·폼 라벨·버튼 라벨·강조 수치. Regular = 그 외 전부.
  중간 굵기(500)는 **토큰에서 삭제**했다 — 500이 필요해 보이면 그 자리는 제목이거나 본문이다.
- **자간**: 토큰이 아니다. 큰 사이즈에서도 normal이 기본이고(제목의 `-0.02em` 제거),
  예외는 셋뿐이다 — 워드마크 `0.18em`(로고타입), 초대 코드 `0.08em`/`0.24em`(0/O 구분).
- **행간 2단계**: 1.25 / 1.6. (여전히 임시값 — §7)
- **서체**: 본문 `--font-sans`(Noto Sans KR, 자체 호스팅). `--font-numeric`(Inter 우선, 설치됨)은
  날짜·통계 숫자처럼 라틴/숫자 비중이 큰 자리에만 제한적으로. 기아 전용 서체는 없으므로
  **굵기 원칙만** 가져왔고 새 폰트를 추가하지 않았다.
- **컨트롤 치수**: `--control-height` 48px(기아 버튼 규격), 좌우 패딩 24px(`--space-6`),
  `--touch-target` 44px(WCAG 2.5.8 하한).

### z-index 3단계

| 토큰 | 값 | 쓰는 곳 | 쓰면 안 되는 곳 |
|---|---|---|---|
| `--z-canvas` | 0 | 노선도 SVG·카카오맵처럼 **남의 DOM이 들어오는 캔버스 컨테이너**. 0을 명시해 스택 문맥을 만드는 게 목적 | 일반 콘텐츠 |
| `--z-canvas-control` | 10 | 캔버스 **위**에 얹히는 컨트롤·오버레이(`.zoomControls`, 지도 빈 상태 안내) | 캔버스 밖 요소 |
| `--z-dialog` | 100 | 모달 딤·다이얼로그·전체화면 뷰어 | 그 외 전부 |

세 단계 사이의 정수 값을 임의로 쓰지 않는다. 스케일 밖의 `z-index: 1`이 7곳 남아 있는 건
의도다(탭바·토스트·FAB·저장 바·역 상세 추가 바·뷰어 안쪽 버튼 2종) — 그건 "형제 사이의 순서"일
뿐 전역 레이어가 아니다. 이 스케일은 **내가 통제하지 못하는 DOM 위에 얹히는 것**에만 쓴다.
검증은 눈이 아니라 `document.elementFromPoint(버튼 중앙)`으로 한다.

---

## 5. 접근성 규칙

- 포커스 링은 `index.css`의 `:focus-visible` 한 곳에서만 정의한다(2px `--color-focus`, offset 2px).
  컴포넌트에서 `outline: none`을 쓰지 않는다. 레퍼런스에 포커스 상태 기술이 없어도 지우지 않는다.
  `.input:focus`가 테두리를 바꾸는 건 포커스 링을 **대체**하는 게 아니라 보태는 것이다.
- 터치 타깃 최소 44×44px. 입력·버튼 `min-height: 48px`, 텍스트 링크·칩·탭 `min-height: 44px`.
- **색만으로 상태를 알리지 않는다.**
  - 활성 탭 = 색 + 굵기 + 상단 인디케이터 바
  - 입력 에러 = 테두리색 + 바닥 틴트 + **문구**(`.error`)
  - 입력 비활성 = 색 + **파선 테두리**
  - 감정·날씨 선택 = 색 + 테두리 두께 + 글자 굵기(이모지 자체가 형태 단서)
  - 위험 동작 = 색이 아니라 **윤곽 → hover 시 채움 전환**
  - 버튼 비활성 = 채움이 브랜드 색 페이드(`--color-primary-disabled`)로 바뀌고 `disabled` 속성이
    접근성 트리에 노출된다. **opacity로 흐리지 않는다** — 반투명 채움 위 글자는 뒤 배경에 따라
    대비가 흔들린다. 불투명 합성값이라 라벨 대비가 4.91:1(라이트)/4.82:1(다크)로 고정된다.
- **링크는 밑줄을 유지한다**(`index.css`의 `a`). `--color-primary`가 `--color-text`와 값이
  같으므로(둘 다 차콜, 다크는 둘 다 흰색) 밑줄이 없으면 문장 안의 링크가 주변 글자와 완전히
  같은 픽셀이 된다 — 색은 단서가 될 수 없다. Tailwind preflight가 `a { text-decoration: inherit }`를
  깔기 때문에 `text-decoration-line: underline`을 **명시적으로** 선언해야 한다.
  - 밑줄을 끄는 예외는 **형태 자체가 클릭 대상임을 알리는 링크**뿐이고 각자 클래스에서 명시한다:
    카드 전체 링크, 탭바, 추천 칩, 노선도/지도 토글, 버튼 모양 링크(`no-underline`).
  - 밑줄 하나로 부족한 두 컨텍스트는 굵기 700 + 밑줄 2px을 더한다: `.errorBanner a`, `.card p > a`.
- 이동·부양 효과는 이 시스템에 **존재하지 않는다**(재브랜딩으로 버튼 translate·그림자 제거).
  `prefers-reduced-motion: reduce`에서는 남은 transition을 끈다.
- **지도/노선도 위에 얹히는 컨트롤은 반투명 금지.** `--color-surface`(불투명) + 경계는
  `--color-border`가 아니라 **`--color-border-strong`**(3:1 이상)을 쓴다. 그림자가 없어진 만큼
  이 선이 유일한 경계다. 적용 대상: 줌/전체 핀 보기 버튼, 지도 핀 정보창, 지도 빈 상태 오버레이,
  열린 메뉴.
- **사진 위 컨트롤**은 `--color-scrim` + `--color-on-scrim`(항상 흰색)을 쓴다.
  `--color-text-inverse`를 쓰면 다크에서 어두운 스크림 위 어두운 글자가 된다(2026-08-31 수정).
- 로딩 스켈레톤은 애니메이션 없는 플랫 블록이다. 진행 상태는 움직임이 아니라
  `role="status"` 문구가 전달한다.

---

## 6. 브랜드

워드마크는 **텍스트 로고타입**이다 (`src/components/Wordmark.tsx`, `.brand`).
일러스트·캐릭터·장식 아이콘은 쓰지 않는다 — 위계는 타이포와 여백이 만든다.

- 글자: "동네 발자취", 13px / 700 / 자간 `0.18em` / `--color-text`.
  넓은 자간은 "큰 글자 자간 normal" 규칙의 의도된 예외다 — 로고타입에서는 자간 자체가 형태다.
- 마크: 대각선으로 놓인 원 두 개(발자국 추상화), `--color-primary` + 뒤 발자국 `opacity: .5`.
  16×16 CSS 도형이라 에셋이 없다. `--radius-circle`을 쓰는 몇 안 되는 자리이고,
  순수 장식이므로 `aria-hidden`.
- **미인증 화면에서만** 쓴다. 로그인 뒤에는 탭바가 정체성을 대신한다.

---

## 7. 아직 정하지 않은 것 (placeholder)

- **행간(`--line-height-*`)** 은 여전히 임시값이다. 크기·굵기·자간은 확정됐다.
- **노선 색상** — `--line-2` 외 노선은 `--line-default`(Steel Alt)로 떨어진다.
  새 색을 넣을 때 추천 칩(12%/20%)과 역 심볼 농도(F-03) 대비를 재계산한다.
- **감정·날씨 아이콘 / 방문·미방문 스탬프** — 색 정의 없음(이모지·채움 여부로만 구분).
- **다크 모드 검증 범위** — 프레임·배경·서피스·텍스트·버튼·카드·칩·탭바까지 실렌더 확인
  (2026-08-31, mobile/tablet/desktop × 라이트/다크). 노선도 SVG·카카오맵 오버레이는 로그인이
  필요해 이번에도 미검증이다.
- **`.dark` 클래스 토글 미사용** — 값은 넣어 뒀지만 켜는 UI(테마 스위처)가 없다.
  지금은 OS 설정(`prefers-color-scheme`)만 유효하다.

---

## 8. shadcn/ui 별칭

shadcn 프리미티브(Button, Input, Textarea, Dialog)가 기대하는 표준 변수명
(`--background` `--foreground` `--card` `--popover` `--primary` `--secondary` `--muted`
`--accent` `--destructive` `--border` `--input` `--ring` `--radius`)을 `tokens.css`에
**별칭으로만** 둔다. 값의 출처는 항상 `--color-*`다 — 여기서 새 색을 정의하지 않는다.

- `--input`은 `--color-border-strong`을 가리킨다(입력 테두리는 `--color-border`가 아니다).
- `--radius`는 `--radius-control`(0)이다. shadcn 기본 테마의 `calc(var(--radius) - 2px)`
  파생 공식을 쓰지 않는다 — 이 시스템의 반경은 계산식이 아니라 두 개의 역할 토큰이다.
- `--secondary`와 `--accent`가 같은 중립 톤을 가리키는 것은 의도다. 이 브랜드에 "악센트 색"은 없다.
- Tailwind 매핑(`tailwind.config.ts`): `rounded-sm/DEFAULT/md` → control(0),
  `rounded-lg/xl` → card(15px), `rounded-full` → circle(50%). `boxShadow` 확장은 없다.
