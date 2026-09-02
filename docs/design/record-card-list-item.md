# 기록 목록 카드 — 비주얼 스펙 (2026-09-02)

> 대상: `src/components/RecordCard.tsx` + `RecordCard.module.css` — 역 상세(04)와 타임라인(08)이
> 공유하는 **목록 카드**다.
> `docs/design/record-card-review.md`는 이름이 비슷하지만 다른 것이다 — 그쪽은 캔버스로 그려
> 이미지로 내보내는 **공유 카드**다. 이 문서는 화면 안 리스트 아이템만 다룬다.

## 1. 구조

```
<li .item>
  <a .stationLink>       ← 08에서만 렌더(04는 이미 역이 정해진 화면이라 없다)
  <a .card>              ← 카드 전체가 상세로 가는 링크
      .thumbWrap > .thumb | .thumbFallback     (사진 있을 때만)
      .body
        .metaRow  → .date + 감정·날씨 이모지
        .excerpt  (최대 2줄 말줄임)
        .tags     → .tag ×N (+N)
        .author
```

두 링크는 **형제**다(중첩 아님). 역명 칩을 카드 링크 안에 넣으면 링크 중첩이 되므로 마크업을
이 순서로 유지한다.

## 2. 역명 칩 (`.stationLink`) — 2026-09-02 신규 스펙

기존에는 테두리·배경 없는 흐린 텍스트라 카드 안에서 "누를 수 있는 것"으로 읽히지 않았다.
같은 화면의 태그 필터 칩(`timeline.module.css .chip`)과 같은 규격의 **칩 버튼**으로 통일했다.

| 항목 | 값 |
|---|---|
| 배치 | `inline-flex`, 카드 위, 아래 여백 `--space-1`(4px) |
| 높이 | `min-height: var(--touch-target)`(44px) — 앱의 모든 칩·메뉴 항목과 같은 하한 |
| 패딩 | `var(--space-1) var(--space-3)`(4/12px) |
| 타이포 | `--font-size-sm`(13px) / Regular — 카드 주 제목(`.date`, Bold)보다 아래 위계 |
| 반경 | `20%` — 컨트롤 반경(10px)보다 더 동글게. **이 시스템에서 유일한 퍼센트 반경**이며 사용자가 이 칩에만 지정한 값이다 |
| 밑줄 | 없음(`text-decoration: none`) — 형태가 이미 클릭 대상임을 알린다 |

| 상태 | 글자 | 배경 | 테두리 |
|---|---|---|---|
| 기본 | `--color-text-muted` | 투명 | 1px `--color-border-strong` |
| hover | `--color-primary` | `--color-surface-muted` | 1px `--color-primary` |
| focus-visible | 기본과 동일 | 기본과 동일 | + 전역 링 2px `--color-focus`, offset 2 (`index.css`) |
| active/방문 | 별도 없음 | | |
| 전환 | 색·배경·테두리 140ms ease, `prefers-reduced-motion`에서 1ms | | |

대비(계산값, WCAG 2.1):

| 조합 | 라이트 | 다크 | 기준 |
|---|---|---|---|
| 글자 `--color-text-muted` / 페이지 `--color-bg` | 10.16 | 10.50 | 4.5 |
| 테두리 `--color-border-strong` / 페이지 `--color-bg` | 4.91 | 5.05 | 3.0 |
| hover 글자 `--color-primary` / `--color-surface-muted` | 17.56 | 16.03 | 4.5 |

**알려진 한계 — 퍼센트 반경.** `20%`는 가로 반경이 **칩 폭에 비례**한다. "시청"(짧음)은
가로 ≈10px / 세로 8.8px로 거의 원형에 가깝게 읽히지만, "동대문역사문화공원"(김)은
가로 ≈53px / 세로 8.8px의 **납작한 타원 모서리**가 되어 같은 목록 안에서 칩 모양이 달라진다.
사용자가 지정한 값이라 그대로 두되, 모양을 통일하고 싶다면 대안은 고정 반경(예: 20px)이나
알약(999px)이다 — 둘 다 폭과 무관하게 같은 곡률을 준다.

## 3. 카드 (`.card`)

| 항목 | 값 |
|---|---|
| 배경 / 테두리 / 반경 | `--color-surface` / 1px `--color-border` / `--radius-card`(15px) |
| 패딩 · 내부 gap | `--space-3`(12px) |
| hover | 배경 `--color-surface-muted` |
| 썸네일 | 폭 88px 고정, `aspect-ratio`는 원본 비율, 반경 `--radius-control`(10px), `object-fit: cover` |
| 일기 발췌 | 2줄 클램프 + 말줄임 (04 F-05) |
| 태그 | `--font-size-xs`, 배경 `--color-surface-muted`, 반경 `--radius-control` |

- 카드 전체가 링크이므로 전역 `a` 밑줄을 끈다. 클릭 대상임은 카드 형태와 hover 배경이 알린다.
- 접근 가능한 이름은 `aria-label` 한 문장으로 합친다(04 §6) — 태그·작성자는 `aria-hidden`.

## 4. 반응형

| 폭 | 동작 |
|---|---|
| `<768px` | 목록이 화면 폭 전체(좌우 패딩 24px). 카드는 폭 100%, 썸네일 88px 고정이라 본문 영역만 줄어든다 |
| `≥768px` | 480px 앱 프레임 안. 카드 폭은 프레임에 종속되고 규격은 동일하다 |

역명 칩은 어느 폭에서도 44px 높이를 유지한다. 역명이 아주 길면 칩이 목록 폭까지 늘어난 뒤
줄바꿈된다 — 폭 제한을 두지 않는 이유는 역명을 자르면 어느 역인지 알 수 없기 때문이다.
