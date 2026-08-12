# 앱 프레임 (App Frame)

구현: `src/styles/app-frame.module.css`, 마운트 위치: `src/App.tsx`
관련: `src/components/AppShell.module.css`(탭바), `src/styles/ui.module.css`(`.screen`)

## 문제

`.screen`이 `max-width: 560px`로 폭은 제한돼 있었지만, 배경이 뷰포트 전체를 흰색으로 깔고
탭바는 `position: fixed; left:0; right:0`으로 화면 전체 폭까지 뻗었다. 결과적으로 넓은 창에서
"가운데 좁은 글자 덩어리 + 사방 흰 여백 + 폭이 안 맞는 탭바"로 보였다.

## 해결

라우팅 트리 전체(미인증 화면 + `AppShell`)를 하나의 프레임 카드 안에 넣는다.
두 트리의 공통 조상은 `App.tsx`뿐이므로 그 위치에 순수 프레젠테이션 `div` 2개를 둔다.

```
<BrowserRouter>
  <div class=backdrop>      ← 브랜드 톤 배경 (≥768px에서만 보임)
    <div class=frame>       ← 앱 카드 = 데스크톱에서 스크롤 컨테이너
      [config 경고]
      <Routes/>             ← .screen | .shell | .centerBox
```

## 브레이크포인트별 동작

브레이크포인트 **768px** 하나. (미디어 쿼리는 CSS 변수를 못 받으므로 하드코딩 —
바꾸면 이 문서도 같이 고친다.)

| | < 768px (mobile) | ≥ 768px (tablet / desktop) |
|---|---|---|
| 백드롭 | 없음(투명), `min-height: 100dvh` | `--app-backdrop` 그라디언트, `height: 100dvh`, 중앙 정렬, padding 32px |
| 프레임 폭 | 100% (풀블리드) | `480px` 고정 |
| 프레임 높이 | 콘텐츠만큼 (문서가 스크롤) | `min(100dvh - 64px, 900px)`, 프레임이 스크롤 |
| 모서리 | 0 | `28px` + 1px 외곽선 + `--shadow-frame` |
| 스크롤 컨테이너 | 뷰포트 | 프레임 (`overscroll-behavior: contain`) |
| 탭바 | `sticky bottom:0` → 뷰포트 바닥, 전체 폭 | `sticky bottom:0` → 프레임 바닥, 478px |

### 왜 480px인가

- 모바일 앱의 손맛을 유지해야 하므로 큰 폰(390~430pt)보다 살짝 넉넉한 선.
- 560px(기존 `--content-max-width`)는 데스크톱에서 "웹 문서"처럼 보이고 프레임 느낌이 죽는다.
- 420px 이하는 초대 코드(40px 고정폭) · 노선도 SVG가 답답해진다.
- 768px 뷰포트에서도 480 + 좌우 32 패딩 = 544px라 백드롭이 224px 남아 프레임이 프레임으로 읽힌다.

### 왜 fixed가 아니라 sticky인가

`position: fixed`는 뷰포트 기준이라 프레임 안에 가둘 수 없다(`left:50% + translateX`로 폭은
맞출 수 있지만, 프레임이 스크롤 컨테이너가 되면 다시 어긋난다). `sticky bottom: 0`은 각
환경의 스크롤 컨테이너 바닥에 붙으므로 모바일·데스크톱 양쪽에서 자동으로 맞는다.
흐름 안에 있으므로 `.main`의 하단 패딩 보정도 필요 없어졌다.

## 높이 전파

`.backdrop`(flex column) → `.frame`(flex column) → `.frame > :last-child { flex: 1 0 auto }`.

`:last-child`인 이유: 프레임의 첫 자식은 Supabase 미설정 경고 배너일 수 있고 그건 늘어나면
안 된다. 라우팅된 화면은 항상 마지막 자식이다.

`min-height: 100%` 대신 `100dvh`를 쓴 이유: 조상 체인의 `height` 확정 여부에 의존하지 않고,
모바일 주소창 접힘까지 따라가기 위해서.

## 짧은 화면의 세로 정렬 (2026-08-12 수정)

`.screen`은 **`justify-content: flex-start`** — 항상 상단 정박이다.

원래는 `safe center`로 프레임 안에서 세로 중앙에 놓았는데, 프레임 높이가
`min(100dvh - 64px, 900px)`라 로그인처럼 짧은 화면은 폼 **위에** 목적 없는 빈 공간이 크게
떴다. 사용자 피드백의 1순위 지적이었다 (`revision-2026-08-12-auth-frame.md`).

바꾼 규칙:

- 위쪽 여백은 `.screen`의 `padding-top: 32px` + 헤더 블록(워드마크→제목→부제)이 **쓴다**.
  없애는 게 아니라 의도가 있는 여백으로 바꾼 것이다.
- 남는 공간은 전부 **아래**에 한 덩어리로 모인다. 콘텐츠가 프레임보다 짧으면 카드 하단이
  비는데, 이건 실제 폰에서 짧은 화면을 볼 때와 같은 상태라 어색하지 않다.
- 하단 링크 줄(`.linkRow`)을 `margin-top: auto`로 프레임 바닥에 정박시키는 안도 렌더해
  비교했지만, 버튼과 링크 사이에 200px 넘는 구멍이 생겨 오히려 미완성으로 보였다. 폐기.

빈 공간이 가장 크게 보이는 조합은 태블릿(768×1024 → 프레임 900px 높이, 콘텐츠 약 560px)이다.
그 폭에서도 렌더 확인했다.

## 상태

프레임 자체는 상호작용이 없다. hover/active/disabled 없음.

| 상태 | 동작 |
|---|---|
| 기본 | 위 표대로 |
| 스크롤 중 (≥768px) | 프레임 내부만 스크롤, 백드롭 고정. 체인 스크롤은 `overscroll-behavior: contain`으로 차단 |
| 스크롤바 | `scrollbar-width: thin` + `--color-border-strong`. 둥근 모서리를 덜 깎도록 |
| 다크 | 백드롭이 프레임보다 **더 어둡다**. 라이트와 명암 관계가 반대 — 다크에서 카드는 떠오르는 쪽이어야 하므로 |
| 모달 열림 | 다이얼로그 오버레이는 `position: fixed; inset: 0`이라 프레임이 아니라 화면 전체를 덮는다. 의도한 동작(프레임 안에 갇힌 모달은 답답하다) |

## 검증 기록 (2026-08-12, Chrome 헤드리스 실측)

- 가로 오버플로 없음: 375 / 768 / 1280 전부 `scrollWidth === clientWidth`.
- 탭바 rect — mobile `x=0 w=375`, tablet `x=145 w=478`, desktop `x=401 w=478`.
- 탭 링크 높이 55px (≥ 44px 터치 타깃).
- 스크롤 최하단에서도 탭바 유지(모바일=뷰포트 바닥, 데스크톱=프레임 바닥).
- 라이트/다크 × 3폭 = 6조합 모두 렌더 확인 (`/login`, `/signup`, 404, 주입한 AppShell).
