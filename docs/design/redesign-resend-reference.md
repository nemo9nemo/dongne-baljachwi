# Resend 레퍼런스 재구성 — 판단 기록 (2026-08-21)

> 트리거: 사용자가 `C:\Users\love0\Downloads\DESIGN.md`(Resend 마케팅 페이지 캡처 문서)를
> 첨부하고 "shadcn/ui와 함께 써서 이 프로젝트 디자인을 재구성하라"고 지시.
> 이 문서는 그 판단 과정과 결론을 기록한다. 실제 변경분은 `src/styles/tokens.css`,
> 요약은 `docs/design/system.md` §8.

## 1. 권위 순서를 어떻게 적용했나

`DESIGN.md` §7 Governance가 자기 문서의 적용 우선순위를 스스로 명시한다:

> 1. 직접 사용자 지시  2. 리포지토리 사실  3. 이 문서(Resend 참고자료)  4. 참고 영감

이 프로젝트에서 "리포지토리 사실"은 최소 세 가지가 이미 확정돼 있었다.

1. **PRD §2 페르소나** — "지하철로 데이트하는 20~30대 커플". 다정하고 사적인 추억 기록
   앱이지, Resend가 대상으로 하는 "개발자/제품 빌더"가 아니다.
2. **2026-08-19 흑백 심플모던 개편**(커밋 `064a2a0`) — primary/danger를 색이 아니라
   채움/윤곽 형태로 구분하기로 대비 재계산까지 마쳐 확정. `tokens.css` 상단 주석에 근거가
   남아 있다.
3. **기록 카드 색 규칙**(`docs/design/record-card-review.md` §1, 2026-08-20 사용자 결정) —
   카드 색은 생성 시점 앱 테마를 따르고(다크=검정+흰 테두리, 라이트=흰+검정 테두리),
   감정·날씨는 텍스트 라벨 전용, 워터마크 문구 고정.

세 가지 모두 Resend 참고자료보다 우선한다. 그래서 이번 재구성은 "Resend처럼 만들기"가
아니라 "Resend에서 이 앱에 옮겨 심어도 되는 어휘만 골라 쓰기"가 됐다.

## 2. 가져온 것 / 버린 것

### 가져온 것

| Resend 요소 | 이 앱에 옮긴 형태 | 왜 옮겼나 |
|---|---|---|
| 다크 캔버스 + "소란스럽지 않은 정밀함"이라는 태도(§1 Principles 2) | 그대로 유지 — 2026-08-19 흑백 개편이 이미 같은 방향이었다 | 새로 만들 필요가 없었다. 확인만 했다 |
| 쿨 반투명 헤어라인(`rgba(214,235,253,0.19)`) | `--color-hairline`(무채색 `rgb(0 0 0/12%)` 라이트, `rgb(255 255 255/14%)` 다크) | 색상(쿨톤 블루)은 버리고 "반투명 경계로 깊이를 낸다"는 기법만 가져왔다. 검정 캔버스에서 `box-shadow`가 잘 안 보이는 문제(다크 카드가 이미 거의 검정이라)를 헤어라인이 보완한다 |
| shadcn/ui 표준 변수명 기대(§ Governance는 다루지 않지만 사용자의 명시적 지시) | `tokens.css`에 `--background` 등 별칭 블록 | 사용자가 명시적으로 요청한 부분 — 참고 영감이 아니라 직접 지시(우선순위 1위)다 |
| "선택 상태는 색만이 아니라 형태로도 구분" 이라는 관찰(Resend selected tab panel, selected menu option) | 기존 `.tabActive`(색+굵기+인디케이터 바), `.chipOn`(채움+반전 텍스트)이 이미 이 원칙을 만족 — 새로 만들 것 없이 **검증만 했다** | 이 앱의 접근성 규칙(§5, "색만으로 상태 구분 금지")이 Resend보다 이미 더 엄격했다 |

### 버린 것

| Resend 요소 | 왜 버렸나 |
|---|---|
| `#00a3ff` 프라이머리 블루 | 2026-08-19 개편이 "강조는 채움/윤곽 형태로, 색은 흑백만"을 대비 재계산까지 마쳐 확정한 리포지토리 사실. 커플 다이어리에 개발자 툴의 차가운 블루를 얹는 것도 페르소나(PRD §2)와 정서적으로 맞지 않는다고 판단했다. `--secondary`와 `--accent`가 같은 중립 톤을 가리키는 것도 이 판단의 결과다 |
| Domaine Display / ABC Favorit | 한글 글리프가 없는 라틴 전용 서체. 전체 한글 UI인 이 앱에 그대로 쓰면 시스템 폰트로 조용히 폴백된다 — DESIGN.md 자신이 "시스템 폰트를 갖다 놓고 이 서체라고 우기지 마라"고 경고한 바로 그 실수가 된다. 대신 §3 참고 |
| 4px 샤프 프라이머리 CTA 반경 | `--radius-md`(12px)는 이미 "컨트롤 높이 48px·프레임 반경 28px과 계열을 맞췄다"는 근거로 최근 확정된 값(`system.md` §4). Resend 참고 하나로 되돌릴 이유가 없다. 대신 이 앱은 "버튼(사각 계열, 6/12/16px)" vs "칩·태그·탭바(pill)"라는 **컴포넌트 종류로** Resend의 "샤프 CTA vs 풀필 아웃라인" 대비를 이미 구현하고 있었다(§4) |
| 관찰되지 않은 hover/focus/toast/dialog 변형 | DESIGN.md 자신이 "공급된 캡처에서 이런 상태를 지어내지 마라"고 명시(§4 Don't). 이 앱에 필요한 hover/focus/disabled/error 상태는 각 기능 스펙 §6(접근성)에서 가져왔다 — Resend에 없다고 빼지 않았고, Resend에 없는데 있는 척 새로 지어내지도 않았다 |
| 지도/노선도 위 반투명 컨트롤 | `system.md` §5가 이미 금지하고 있던 규칙(불투명 서피스 강제) — Resend의 헤어라인은 그 규칙의 예외가 아니다. §4 참고 |

## 3. 한글 타이포그래피 판단

Domaine Display·ABC Favorit는 쓸 수 없다(§2). 이 앱은 이미 Noto Sans KR을 자체 호스팅
(`@fontsource/noto-sans-kr`)해서 쓰고 있고, 2026-08-19에 이 서체로 확정했다 — 재검토
대상이 아니다.

Resend의 "무게감"(에디토리얼 히어로 vs 절제된 컨트롤)은 서체가 아니라 **크기·굵기·자간**의
문제로 재현했다:

- 새 타이포 단계를 추가하지 않았다 — `CLAUDE.md`/디자인 원칙이 "타이포 5~6단계 상한"을
  못박아 뒀고, 이미 `xs/sm/md/lg/xl/code` 여섯 단계가 그 상한이다.
- 대신 기존 `--font-size-code`(40px, 초대 코드 전용)에 `--font-size-display`라는
  **별칭**을 붙였다. 프로필의 디데이·통계 히어로 숫자처럼 "포스터 헤드라인" 무게가 필요한
  자리에 같은 40px을 재사용하라는 신호다. 이 앱의 프레임 폭(~480px)에서는 40px이 이미
  충분히 "히어로"급이라(Resend의 96px 히어로는 1440px 데스크톱 마케팅 페이지 기준이라
  그대로 옮기면 이 앱에서는 과하다), Resend의 실제 px 값을 가져오지 않고 비율 감각만
  옮겼다.
- `--font-numeric`(`Inter, 'Noto Sans KR', system-ui, …`)을 추가했다. Inter는 라틴/숫자
  전용이라도 지정 안 된 한글은 다음 폴백(Noto Sans KR)으로 자연스럽게 넘어가는 정상적인
  스택이다(브리프가 직접 언급한 패턴). 날짜·통계 숫자·디데이처럼 숫자 비중이 큰 자리에
  제한적으로 써서 "정밀한 제어 UI"라는 Resend Inter의 역할을 부분적으로 재현한다.
  **다만 지금은 미설치 상태다.** `@fontsource/inter`(또는 동급)를 추가하기 전까지는 시스템
  산세리프로 폴백되고, 그 상태를 "Inter 적용됨"이라 부르면 안 된다 — 이건 developer-frontend
  이관 항목이다(§6).

## 4. shadcn/ui 변수 매핑 전략

`tokens.css`에 표준 shadcn 변수명(`--background`, `--foreground`, `--card`, `--popover`,
`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`,
`--ring`, `--radius` 등)을 **별칭으로만** 추가했다. 기존 `--color-*` 이름은 전 화면
CSS 모듈이 이미 참조하고 있어 유지해야 했고(브리프가 명시), 별칭 전략을 택한 이유:

- 값을 두 곳에서 관리하지 않는다 — 모든 별칭이 `var(--color-*)`를 가리키므로, 라이트/다크
  전환은 기존 `--color-*` 정의(`:root` + `@media (prefers-color-scheme: dark)`)를
  그대로 따라간다. 새 리터럴을 하나도 추가하지 않았다(`--color-hairline`, `--font-numeric`,
  `--font-size-display`는 정말 새 토큰이라 예외).
- shadcn 컴포넌트가 들어와도 기존 컴포넌트(`ui.module.css`의 `.button`/`.input` 등)를
  건드리지 않는다 — 두 계열이 같은 `--color-*` 소스를 공유하므로 시각적으로 어긋나지 않는다.
- `--radius`만 예외적으로 주의가 필요하다. shadcn 기본 테마는 `calc(var(--radius) - 2px)`
  같은 파생 공식으로 sm/md/lg를 만드는데, 이 프로젝트는 반경도 "유한한 단계만"
  (`--radius-sm/md/lg/pill` = 6/12/16/999px, 계산식이 아니라 표)이라는 원칙이 있다.
  **developer-frontend가 Tailwind `borderRadius`를 이 네 토큰에 직접 매핑**하고, `--radius`
  자체는 "기본값이 필요한 shadcn prop"에만 쓰는 걸 권한다 — calc 공식을 쓰면 6/12/16px
  체계에서 벗어난 임의의 반경이 생겨날 수 있다.
- `--accent`와 `--secondary`가 같은 값(`--color-surface-muted`)을 가리키는 것도 판단이
  필요했다. 이 앱에는 "악센트 색"이 없다(§2) — 둘 다 "은은한 hover/보조 배경"이라는 같은
  역할이라 억지로 갈라놓지 않았다.

### `.dark` 클래스 — 지금은 잠들어 있는 경로

shadcn/ui는 보통 `next-themes` 등으로 `<html class="dark">`를 토글하는 걸 전제한다. 이
앱은 지금 `prefers-color-scheme` 미디어 쿼리로만 다크를 판정한다(수동 토글 UI가 없다).
두 경로를 다 지원하려고 `.dark` 클래스 블록을 `@media` 블록과 **완전히 동일한 값**으로
`tokens.css`에 미리 넣어 뒀다 — CSS 커스텀 프로퍼티에는 상속/재사용 문법이 없어 리터럴을
두 곳에 둘 수밖에 없었다(값을 고칠 때는 두 블록을 같이 고쳐야 한다는 주석을 남겨 뒀다).
`light-dark()`(Baseline 2024) 기반으로 재작성하면 중복을 없앨 수 있지만, 이미 검증된
라이트/다크 구조를 이번 라운드에서 흔들지 않으려고 보류했다 — 수동 토글 UI를 실제로 만들
때 developer-frontend가 판단할 문제로 남긴다.

## 5. 컴포넌트 비주얼 스펙 매핑

Resend 레퍼런스가 실제로 캡처한 컴포넌트(프라이머리 CTA, 아웃라인 필, 헤더 내비, 선택된
탭 패널, 열린 메뉴 리스트박스, 선택된 메뉴 옵션, 비활성 액션)를 이 앱의 실제 컴포넌트에
매핑했다. **Resend가 관찰하지 않은 상태(hover/focus/toast/dialog 등)는 만들어 내지
않았다** — 아래 표의 각 항목은 이 앱 자체 스펙(괄호 안)의 접근성 요구사항에서 가져온다.

| Resend 컴포넌트 | 이 앱 컴포넌트 | 매핑/차이 |
|---|---|---|
| Primary CTA(샤프 4px, 채움, 흰 글자) | `ui.module.css` `.buttonPrimary` | 채움 원칙은 같다. 반경은 4px가 아니라 `--radius-md`(12px, 기존 확정값 유지 — §2). hover/active/disabled 상태는 Resend에 없으므로 이 앱 자체 접근성 요구사항(각 스펙 §6)을 그대로 따른다(이미 구현됨, 변경 없음) |
| Outline pill(풀필, 쿨 헤어라인, 옅은 텍스트) | `timeline.module.css` `.chip` / `profile.module.css` `.chip` | 이미 풀필(`--radius-pill`) + `--color-border-strong` 아웃라인이다. 헤어라인 대신 solid 보더를 쓰는 이유: 칩은 카드 위가 아니라 화면 배경(불투명이지만 워시가 얹힌) 위에 바로 놓이므로, 장식용 헤어라인보다 기능적 경계(3:1 이상, §2)가 더 필요하다 |
| Selected tab panel(반투명 쿨 필) | `AppShell.module.css` `.tabActive` | 색+굵기+상단 인디케이터 바로 이미 색만이 아닌 구분을 하고 있다 — Resend의 "색상 필"보다 이 앱 쪽이 접근성 요구사항(§5)을 더 강하게 만족한다. 바꿀 이유 없음 |
| Selected menu option(반투명 옅은 필) | `timeline.module.css` `.chipOn` | 채움(`--color-primary`) + 반전 텍스트로 이미 형태 구분이 있다. 그대로 유지 |
| Opened menu listbox(검정 배경 + 헤어라인 보더) | `line-map.module.css` `.select` | `.select`는 노선도 헤더 행(불투명 화면 배경 위)에 있어 `--color-hairline`을 보더에 얹는 게 안전하다 — 단, **캔버스(`.canvasWrap`) 위에 직접 얹히는 `.zoomControls` 등은 예외**로, 거기는 계속 `--color-surface` 완전 불투명만 쓴다(`system.md` §5). 이번 라운드에서 `line-map.module.css`는 건드리지 않았다 — 다음 라운드에 developer-frontend가 `--color-hairline`을 `.select`의 보더 강조용으로 검토할 수 있다 |
| Disabled automation action(muted 텍스트) | `ui.module.css` `.button:disabled` | 이미 채움 제거 + muted 텍스트로 구현됨(§5 원칙과 동일). 변경 없음 |
| — (Resend에 없음) | `RecordCard`, 기록 카드 이미지(감정·날씨 칩, 태그 칩) | Resend 레퍼런스에 대응 컴포넌트가 없다 — 이미 `docs/design/record-card-review.md`가 "채움(감정·날씨) vs 윤곽(태그)"으로 상세 스펙을 마쳤고, 이번 재구성과 방향이 같다(형태로 구분). 재검토하지 않는다 |

## 6. 기존 확정 사항과의 관계

- **흑백 심플모던(2026-08-19)**: 계승. 색을 하나도 새로 추가하지 않았다(`--color-hairline`도
  무채색). Resend의 다크 캔버스·절제된 헤어라인 어휘가 이미 이 방향과 가까웠다는 사실을
  확인하는 선에서 그쳤다.
- **기록 카드 테마 규칙(2026-08-20)**: 충돌 없음. 카드 팔레트(`cardPalette()`)는 여전히
  `--color-bg`/`--color-text`/`--color-border` 계열을 읽고, 이번에 추가한 토큰(`--color-hairline`,
  `--font-numeric`, shadcn 별칭)은 카드 렌더 코드(`record-image-render.ts`)가 참조하는
  범위 밖이다. 워터마크 문구·이모지 미사용 규칙도 그대로다.
- **`docs/design/system.md`**: 2026-08-19 개편 당시 색상표가 갱신되지 않고 로즈 시절 값으로
  방치돼 있던 걸 이번에 그레이스케일 실제값으로 맞췄다(§2, §3, §4 일부). 이건 새 결정이
  아니라 문서 지연을 바로잡은 것이다.

## 7. developer-frontend가 이어받을 때 알아야 할 것

1. **`--font-numeric`은 미설치다.** `@fontsource/inter`(또는 동급)를 추가하지 않으면
   이 토큰은 시스템 폰트로 조용히 폴백된다. 설치 여부와 무관하게 UI가 깨지진 않지만,
   "Inter 적용"이라고 보고하려면 실제로 로드됐는지 확인해야 한다.
2. **`--radius`를 shadcn 기본 calc 공식으로 파생시키지 말 것.** Tailwind `borderRadius`를
   `--radius-sm/md/lg/pill`에 직접 매핑한다(§4).
3. **`.dark` 클래스는 지금 아무것도 하지 않는다.** OS가 다크가 아닌 한 아무 효과가 없다 —
   수동 테마 토글 UI를 실제로 만들 때만 의미가 생기고, 그때 `@media` 블록과 값을 계속
   동기화해야 한다(`tokens.css` 주석).
4. **`--color-hairline`은 지도/노선도/카카오맵 오버레이 컨트롤에 쓰지 않는다.** 이미
   불투명한 서피스(카드·다이얼로그·`line-map`의 헤더 행처럼 화면 배경 위) 전용이다.
5. **이번 라운드는 `tokens.css`와 문서만 바꿨다.** `.module.css`·`.tsx`는 한 줄도
   건드리지 않았다 — 위 §5 매핑 표의 "그대로 유지" 항목들은 실제로 아직 헤어라인이나
   새 별칭을 쓰고 있지 않다는 뜻이다. shadcn CLI 설치, Tailwind 설정, 컴포넌트 마이그레이션은
   다음 라운드 몫이다.

## 9. developer-frontend 구현 기록 (2026-08-21, Round 1)

§7의 이관 사항을 받아 Tailwind + shadcn/ui를 실제로 설치하고 일부 화면에 적용했다.
**전체 화면을 한 번에 갈아엎지 않는다**는 원칙에 따라 이번 라운드는 "공용 프리미티브 도입 +
인증 화면 6개 + 다이얼로그 3종"까지만 끝냈다 — 나머지는 §9.5에 다음 라운드로 명시한다.

### 9.1 왜 `shadcn@latest init`을 그대로 쓰지 않았나

CLI(v4.18)를 비대화형으로 돌려봤다(`npx shadcn@latest init --template vite -b radix -y`).
그런데 이 버전은 preset(Nova/Vega/Maia/…) 선택이 **대화형 전용**이라 `-y`/`--defaults`로도
건너뛸 수 없었고, 각 preset은 Lucide/Geist 같은 고정 폰트·아이콘 세트를 함께 심는다 — 이
프로젝트가 이미 확정한 Noto Sans KR·"새 팔레트 금지" 원칙과 충돌한다. `--preset custom`도
없다(인터랙티브 메뉴에만 있는 선택지). 그래서 `init`은 포기하고 `components.json`·
`tailwind.config.ts`·`postcss.config.js`·`src/components/ui/*`를 손으로 작성했다 —
`components.json`의 스키마(`https://ui.shadcn.com/schema.json`)는 그대로 따랐으므로
이후 `npx shadcn@latest add <component>` 같은 후속 CLI 명령은 정상적으로 먹는다(스키마
필드는 실제로 검증됨).

### 9.2 설치한 패키지

```
tailwindcss@3.4.19 postcss@8.5.26 autoprefixer@10.5.4      (Tailwind v3 — 아래 §9.3 이유)
class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0   (shadcn 표준 조합)
@radix-ui/react-dialog@1.1.23 (+ 종속 @radix-ui/react-slot)      (Dialog 접근성 엔진)
@fontsource/inter@5.3.0                                          (--font-numeric 실체화)
```

Tailwind는 **v4가 아니라 v3**을 골랐다. v4는 CSS-first(`@theme` 블록)로 테마를 정의하는데,
이 프로젝트의 `--radius-sm/md/lg/pill`은 tokens.css `:root`에 이미 존재하는 이름이라
`@theme inline { --radius-sm: var(--radius-sm); }` 같은 자기 참조 별칭이 되어(같은 이름을
자기 자신에 alias) 애매해진다. v3의 JS 설정(`tailwind.config.ts`)은 `borderRadius: { sm:
'var(--radius-sm)', ... }`처럼 **다른 네임스페이스(JS 객체 키 vs CSS 커스텀 프로퍼티)**라
이 문제가 애초에 없다 — §7-2의 "Tailwind 설정에서 borderRadius를 매핑하라"는 지시와도
문구가 정확히 맞는다.

### 9.3 Tailwind 설정 요약

- `tailwind.config.ts` — `theme.extend.colors`가 tokens.css의 shadcn 별칭
  (`--background`/`--primary`/`--border`/`--input`/`--ring` 등)만 참조한다. 리터럴 색을
  하나도 새로 쓰지 않았다.
- `borderRadius`: `sm/DEFAULT/md/lg/xl/full` → `--radius-sm/md/md/lg/lg/pill`. `calc()`
  파생 없음(디자이너 지시 그대로).
- `fontFamily.sans` = `var(--font-sans)`(Noto Sans KR), `fontFamily.numeric` =
  `var(--font-numeric)`(Inter 우선). shadcn 기본 폰트 스택(Geist 등)을 쓰지 않는다.
- `boxShadow.button`/`button-hover`/`card`/`dialog`, `spacing.control`/`touch`,
  `zIndex.dialog` — 전부 tokens.css 변수 재참조.
- `src/index.css`에 `@tailwind base/components/utilities`를 tokens.css import 뒤,
  기존 전역 리셋 앞에 추가했다. Preflight(Tailwind base)가 초기화하는 항목
  (box-sizing, margin, button/input 폰트 상속 등)은 기존 리셋과 값이 같아 충돌이 없다 —
  클래스 선택자(유틸리티)가 항상 엘리먼트 선택자(전역 리셋)보다 우선하므로 순서와 무관하게
  안전하다.
- 경로 별칭 `@/*` → `src/*`: `vite.config.ts`(`resolve.alias`)와 `tsconfig.app.json`
  (`paths`, `baseUrl` 없이 — TS 6.0.2부터 `baseUrl`이 폐기 예정(TS5101)이라 뺐다) 양쪽에
  등록했다.

### 9.4 만든 프리미티브 (`src/components/ui/`)

| 파일 | 내용 |
|---|---|
| `button.tsx` | CVA 3변형(`default`=채움/`outline`=윤곽 기본값/`destructive`=danger 윤곽→hover 채움). `ui.module.css` `.button`/`.buttonPrimary`/`.buttonDanger`의 색·간격·상태(hover/active/disabled/motion-reduce)를 1:1로 옮겼다. |
| `input.tsx` | `ui.module.css` `.input`을 옮김. `aria-invalid:` Tailwind 내장 변형을 써서 에러 테두리를 표현(문구는 여전히 호출부 `.error`가 담당 — 색만으로 에러를 알리지 않는다는 규칙 유지). |
| `dialog.tsx` | Radix `Dialog` 재수출. **의도적으로 기본 시각 스타일을 두지 않는다** — 이유는 파일 상단 주석 참고(요약: 세 다이얼로그가 이미 검증된 CSS Module `.overlay`/`.dialog`를 갖고 있어서, Tailwind 기본값을 얹으면 같은 우선순위 클래스 두 벌이 로드 순서로 겨루는 상황이 생긴다). |

`utils.ts`(`cn()`)는 `src/lib/utils.ts`에 추가했다 — shadcn 컴포넌트 전부가 요구하는
최소 헬퍼라 "나중에 쓸 것 같아서 만드는 추상화" 금지 원칙의 예외로 판단했다.

Badge/Select/Tabs/Combobox는 **설치하지 않았다**(§9.6 참고).

### 9.5 실제로 바뀐 화면

- **인증 화면 6개** — `LoginScreen`/`SignUpScreen`/`ForgotPasswordScreen`/
  `ResetPasswordScreen`/`VerifyEmailScreen`(+ 폼 없는 `AuthCallbackScreen`은 미해당):
  `<input className={ui.input}>` → `<Input>`, `<button className={ui.button/.buttonPrimary}>`
  → `<Button variant="outline|default">`. `.field`/`.label`/`.hint`/`.error`/`.screen`
  등 레이아웃은 그대로 `ui.module.css`를 쓴다 — 바뀐 건 컨트롤 두 종류뿐이다.
- **다이얼로그 3종** — `ConfirmDialog`/`DissolveCoupleDialog`/`RecordImageDialog`.
  각 화면이 손으로 짜던 접근성 배관(body 포털, 배경 `inert`, Tab 순환, Esc, 포커스
  캡처/복귀 — 화면당 30~50줄)을 Radix `Dialog`로 교체했다. 세 화면 모두 다음 조사로
  기존 `inert` 기반 구현이 실제로 불필요했음을 확인했다:
  - Radix `FocusScope`는 Tab 키를 직접 가로채 순환시킨다(`aria-hidden`이 포커스를 못
    막는다는 기존 주석의 우려가 애초에 발생하지 않는다).
  - `FocusScope`는 마운트 시 `document.activeElement`를 기억했다가 언마운트 시 복원한다
    (기존 `previouslyFocused` 로직과 동일).
  - `FocusScope`는 `document`에 `focusin` 리스너를 걸어 포커스가 트랩 밖으로 새면 스스로
    되돌린다(`node_modules/@radix-ui/react-focus-scope`로 소스 확인) — `DissolveCoupleDialog`가
    갖고 있던 "포커스가 밖으로 떨어지면 되돌린다"는 범용 effect를 지우고, 이 화면만의
    UX 규칙(F-23: 확인 단계 진입 시 입력창으로 포커스 이동)만 남겼다.
  - `Dialog.Title`이 렌더한 `id`를 `Dialog.Content`의 `aria-labelledby`에 Radix가 자동으로
    잇는다 — `id="record-dialog-title"` 같은 수동 배선을 지웠다.
  - `busy`/`pending` 중 Esc·바깥 클릭을 막는 규칙은 Radix `onEscapeKeyDown`/
    `onInteractOutside`에서 조건부 `preventDefault()`로 그대로 재현했다(`onOpenChange`
    한 곳으로는 "닫기 버튼은 되지만 배경 클릭은 막는" `RecordImageDialog`의 미묘한 차이
    — 닫기 버튼은 preparing 중에도 눌리지만 Esc/배경 클릭은 preparing 중에도 막힌다 —
    를 표현할 수 없어 개별 콜백을 썼다).
  - `overlay`/`dialog`의 색·반경·그림자·최대폭(화면별로 다름: 기본 560px vs 기록 카드
    시트 400/460px)은 기존 CSS Module 클래스를 `DialogOverlay`/`DialogContent`의
    `className`으로 그대로 전달해 **한 픽셀도 바꾸지 않았다**.

### 9.6 교체하지 않고 남긴 것과 이유

| 대상 | 판단 |
|---|---|
| `StationPicker`(역 검색) | 초성 검색·IME 조합 처리·화살표 키 결과 이동이 이미 스펙(F-06~F-10)대로 정교하게 구현돼 있다. shadcn Combobox(cmdk 기반)의 기본 필터는 한글 초성을 모른다 — 그걸 얹으려면 필터 함수를 통째로 갈아 끼워야 하는데, 그러면 "실제로 이득"이 아니라 새 리스크만 는다. 프리미티브(Input)만 재사용하고 구조는 유지했다(§9.5에 포함 안 됨 — 이번 라운드는 손대지 않음, 다음 라운드에 `<Input>`으로만 교체 검토). |
| `TagField`(자유 태그) | Enter 전용 확정, 중복 시 플래시, 삭제 알림 등 shadcn에 대응 컴포넌트가 없는 전용 위젯이다. 새로 만들 이유가 없다. |
| `AppShell` 하단 탭바 | `<nav>` + `NavLink`(라우팅 네비게이션)다. shadcn `Tabs`는 ARIA `tablist`/`tabpanel`로 **같은 페이지 안의 패널 전환**을 위한 컴포넌트라 시맨틱이 다르다 — 여기 쓰면 잘못된 추상화가 된다. |
| `LineMapScreen`의 `<select>`(노선 필터) | 네이티브 `<select>`가 이미 접근성·모바일 네이티브 UI를 공짜로 얻고 있고, 디자이너 인수인계 문서(§5)가 이번 라운드에 `line-map.module.css`를 건드리지 않기로 못박았다. shadcn `Select`(Radix)로 바꾸면 이득(커스텀 스타일 가능)보다 이번 범위 밖 화면을 건드리는 리스크가 크다. |
| `RecordEditorScreen`(834줄)·`ProfileScreen`(390줄)·`OnboardingScreen`(313줄)·`InviteScreen`(232줄) | 인증 화면과 같은 `ui.button`/`ui.input` 패턴을 쓰지만 분량이 커서 이번 라운드 예산 밖. **다음 라운드로 명시 이월.** |
| Badge | `StationPicker`의 호선 배지, `TagField`의 칩이 이미 토큰 기반으로 잘 구현돼 있고 각자 조금씩 다른 동작(플래시, 점 색상)이 있어 공용 Badge로 묶을 실익이 적다. |

### 9.7 검증

- `npx tsc -b` — 통과(0 에러).
- `npm run build`(`tsc -b && vite build`) — 통과. 산출물: `dist/assets/index-*.js` 694KB
  (gzip 205KB), `index-*.css` 312KB(gzip 94KB). JS 청크 경고(500KB 초과)는 기존
  카카오맵·Supabase·전 화면 단일 번들 구조에서 이미 존재하던 것이고 이번 라운드가
  새로 키우지 않았다 — 코드 스플리팅은 범위 밖(카카오맵 지연 로드는 §7 규칙대로 이미
  별도 처리돼 있는지 `src/lib/kakao-maps.ts`를 확인했고, 이번 라운드에서 그 파일을
  건드리지 않았다).
- `npm run lint`(oxlint) — 통과(exit 0). 새 경고 1건: `button.tsx`의
  `react/only-export-components`(컴포넌트와 `buttonVariants` 상수를 한 파일에서 함께
  export) — shadcn 표준 패턴이고, 이 하나 때문에 70줄짜리 응집된 파일을 둘로 쪼개는 건
  "파일을 잘게 쪼개는 것 자체가 목적이 되지 않게 한다" 원칙에 반한다고 판단해 그대로
  뒀다. 기존에도 3건의 `react-hooks/exhaustive-deps` 경고가 있었고 이번 변경과 무관하다.
- 브라우저 실렌더 확인(로그인 화면 등)은 이번 세션의 도구 목록에 브라우저 프리뷰 도구가
  없어 스크린샷으로 확인하지 못했다 — build/tsc/lint 통과로만 검증했다. 실제 렌더 확인은
  다음 단계(또는 이 작업을 실행한 orchestrator)가 `mcp__Claude_Browser__preview_start` 등으로
  확인해야 한다.

## 9.8 developer-frontend 구현 기록 (2026-08-21, Round 2)

§9.6이 "다음 라운드로 명시 이월"한 화면 4개(`RecordEditorScreen`/`ProfileScreen`/
`OnboardingScreen`/`InviteScreen`)를 처리했다. 원칙은 Round 1과 동일 — **프레젠테이션
레이어만** 건드리고, `ui.module.css`/`*.module.css`의 레이아웃 클래스(`.field`/`.label`/
`.hint`/`.screen`/`.buttonRow` 등)는 그대로 둔 채 `ui.input`/`ui.button`/`ui.buttonPrimary`/
`ui.buttonDanger` 조합만 `<Input>`/`<Button variant="...">`로 바꿨다.

### 새로 만든 프리미티브

| 파일 | 내용 |
|---|---|
| `src/components/ui/textarea.tsx` | `RecordEditorScreen`의 일기 입력칸(`ui.input` + `record-editor.module.css` `.textarea`)을 옮긴 `Textarea`. `Input`과 색·테두리·hover/focus/aria-invalid/disabled 클래스를 동일하게 유지하고(같은 폼 안에서 두 컨트롤이 달라 보이면 안 된다), 최소 높이 140px·`resize-y`만 textarea 전용으로 얹었다. 라운드 1의 `input.tsx`가 이미 확립한 패턴을 그대로 따랐다 — 새 변형(variant)이나 옵션 없이 단일 컴포넌트다. |

Badge/Select/Tabs/Combobox 등은 이번에도 설치하지 않았다 — 이번 라운드에서 그런 컴포넌트가
필요한 지점이 없었다(아래 "건드리지 않은 것" 참고).

### 화면별 변경

- **`RecordEditorScreen.tsx`**: 로드 실패 재시도 버튼, "작성 중이던 내용" 배너의 두 버튼,
  사진 저장 실패 재시도 버튼, 날짜(`type="date"`) 입력, 일기 `<textarea>` → `<Textarea>`,
  저장 버튼 → `<Input>`/`<Button variant="default"|undefined>`. **건드리지 않은 것**: F-13
  감정/날씨 토글(`styles.toggle`/`.toggleOn`, `role="radiogroup"` 커스텀 위젯 — shadcn
  Button/Input과 시맨틱이 다르다), `StationPicker`/`TagField`/`PhotoField`(사진 파이프라인·
  이탈 방지·`useBlocker` 로직 전부 무변경), `ConfirmDialog` 안의 `<Button>`은 이미 Round 1에서
  교체됨.
- **`ProfileScreen.tsx`**: 이름/사귄 날 인라인 편집 폼(입력+취소+저장), 통계 로드 실패
  재시도, 로그아웃, 커플 연결 해제(`variant="destructive"`) 버튼을 교체했다. **건드리지
  않은 것**: `styles.linkButton`("변경" 토글 버튼) — `ui.button` 계열이 아니라 밑줄 텍스트
  링크로 보이게 만든 완전히 별도의 시각 스타일이다(`record-editor.module.css`의 동명
  `.linkButton`과 같은 패턴). shadcn `Button`을 얹으면 채움/윤곽 프레임이 생겨 "링크처럼
  보이는 버튼"이라는 의도한 형태가 깨지므로 그대로 뒀다 — Round 1의 다이얼로그 3종에도
  이런 클래스는 없었어서 선례가 없다. 추천 역 `<Link className={styles.chip}>`도 버튼이
  아니라 네비게이션 링크라 대상이 아니다.
- **`OnboardingScreen.tsx`**: 이름 단계(입력+제출), 선택 단계(만들기/합류/뒤로 3버튼),
  생성 단계(날짜 입력+제출+뒤로), 합류 단계(코드 입력+제출+뒤로)까지 4단계 전부 교체했다.
  코드 입력은 `<Input className={ui.codeInput}>`으로 — 기존 `ui.codeInput`(고정폭 폰트·
  자간·대문자 변환)이 `Input`의 기본 클래스 뒤에 `cn()`으로 합쳐져 그대로 적용된다(Tailwind
  유틸리티가 아닌 CSS Module 해시 클래스라 `tailwind-merge` 충돌 대상이 아니다 — 값이
  겹치지 않고 그냥 병기된다).
- **`InviteScreen.tsx`**: 코드 만료 시 "돌아가기", 로드 실패 재시도, "코드 복사", "새 코드
  발급", 하단 "먼저 시작하기/돌아가기" 버튼을 교체했다. 이 화면엔 텍스트 인풋이 없다(코드는
  `ui.code`로 표시만 한다).

### 판단이 필요했던 지점

1. **`onboarding` "이름 다시 입력" 버튼이 `<p className={ui.linkRow}>` 안에 있다.**
   `ui.linkRow`의 `a` 전용 스타일(`.linkRow a { ... }`)은 원래도 `<button>`에는 적용되지
   않았으므로(Round 1 이전부터 이미 `<button className={ui.button}>`이었다), `<Button>`으로
   바꿔도 시각적 차이가 없다 — 레이아웃(`display:flex`, `gap`)만 부모 `<p>`가 담당한다.
2. **`RecordEditorScreen`의 `styles.textarea` 클래스가 이제 미사용이다.** `Textarea`
   컴포넌트가 같은 값(최소 높이 140px·`resize: vertical`·`line-height`)을 이미 담고 있어
   JSX에서 `styles.textarea`를 뗐다. CSS 파일 자체는 지우지 않았다 — "CSS Modules 정리"는
   `docs/PROGRESS.md` §6 No.4에 별도 후속 작업으로 남겨 뒀다(이번 라운드 범위는 `.tsx`
   교체이지 CSS 청소가 아니다).

### 검증

- `npx tsc -b` — 통과(0 에러).
- `npm run build` — 통과. `dist/assets/index-*.js` 693.95KB(gzip 204.78KB),
  `index-*.css` 311.84KB(gzip 93.58KB) — Round 1 대비 거의 변화 없음(같은 프리미티브를
  재사용했을 뿐 새 의존성을 추가하지 않았다). 500KB 초과 청크 경고는 Round 1과 동일하게
  기존 구조에서 이어진 것이다.
- `npm run lint`(oxlint) — 통과. 새 경고 0건. 기존 경고 4건(`button.tsx`의
  `only-export-components` 1건 + `exhaustive-deps` 3건)은 Round 1·그 이전부터 있던 것과
  동일하고 이번 변경과 무관하다.
- `npm run dev`로 서버를 띄우고 이번에 수정한 5개 파일(`RecordEditorScreen.tsx`,
  `ProfileScreen.tsx`, `OnboardingScreen.tsx`, `InviteScreen.tsx`, `components/ui/textarea.tsx`)을
  각각 직접 요청해 HTTP 200을 확인했다 — Vite는 변환 중 구문 오류가 있으면 500과 오버레이를
  반환하므로, 200은 최소한 컴파일 가능한 모듈이라는 근거가 된다. 이 4개 화면은 전부 로그인
  후에만 보이는 화면이라, 실제 로그인 세션으로 들어가 인터랙션까지 눈으로 확인하지는
  못했다(Round 1과 같은 한계) — 다음 단계(QA 또는 이 작업의 orchestrator)가 실 로그인
  세션으로 스크린샷 검증을 해야 한다.

## 9.9 developer-frontend 구현 기록 (2026-08-24, Round 3 — QA 결함 수정)

QA가 1·2라운드 완료도를 감사해 `ui.button`/`ui.buttonPrimary`가 그대로 남아 있는 화면 7개
(결함 7건, Major 3 / Minor 4)를 찾았다 — `TimelineScreen`/`StationDetailScreen`/
`RecordDetailScreen`/`guards.tsx`(`LoadFailedBox`)/`PhotoField`/`MapViewScreen`/
`CoupleLinkedScreen`. §9.6·§9.8이 "다음 라운드"로 넘긴 항목이 아니라 **애초에 감사 대상에서
빠졌던 화면들**이다 — 인증 6개·다이얼로그 3종(Round 1), 대형 화면 4개(Round 2) 목록에
이 7개가 포함돼 있지 않았다. 원칙은 Round 1·2와 동일: 프레젠테이션 레이어만, 레이아웃
CSS Module 클래스(`ui.centerBox`/`styles.addBar`/`ui.buttonRow` 등)는 그대로 두고
`<button className={ui.button/.buttonPrimary}>` 조합만 `<Button variant="...">`로 교체했다.

### 새로 만든 것: `Button`에 `ref` prop 지원 추가

이번 7개 중 3곳(`TimelineScreen`/`StationDetailScreen`의 무한 스크롤 "더 보기" sentinel,
`RecordDetailScreen`의 케밥 메뉴 트리거)이 버튼 DOM 노드에 직접 `ref`가 필요했다
(`IntersectionObserver` 관찰 대상, Esc로 메뉴를 닫을 때 포커스 복귀 대상). Round 1의
`button.tsx`는 `ButtonProps`에 `ref`를 선언하지 않아 `tsc`가 즉시 거부했다
(`Property 'ref' does not exist on type ...`). React 19(설치된 `react`/`@types/react`
버전 확인함)부터는 함수 컴포넌트가 `forwardRef` 없이 `ref`를 일반 prop으로 받을 수 있어,
`ButtonProps`에 `ref?: React.Ref<HTMLButtonElement>`를 추가하고 구조분해해 `Comp`(버튼 또는
`asChild`일 때 `Slot`)에 그대로 전달하는 것으로 해결했다 — `forwardRef` 래퍼를 새로 씌우지
않았다(React 19 관용구 그대로, 새 추상화 레이어 아님).

### 화면별 변경

- **`TimelineScreen.tsx`**: 로드 실패 재시도(`variant="default"`), 빈 상태 "첫 기록
  남기기"(`Link`를 감싸는 `Button asChild variant="default"`), 태그 필터 빈 상태 "필터
  해제"(`variant="outline"`), 무한 스크롤 "더 보기"(`variant="outline"`, `ref={sentinelRef}`)
  4곳 교체. FAB(`styles.fab`, `+` 버튼)는 원형 플로팅 버튼 전용 스타일이라 `ui.button` 계열이
  아니고 대상 밖이다(QA 결함 목록에도 없음).
- **`StationDetailScreen.tsx`**: 로드 실패·존재하지 않는 역(`Link`+`Button asChild`
  2곳), 목록 로드 실패 재시도, 빈 상태 "첫 기록 남기기", 무한 스크롤 "더 보기", 하단 고정
  `addBar`의 "이 역에 기록 추가" 6곳 교체. `addBar`는 이 화면에서 가장 눈에 띄는 CTA라
  `variant="default"`(채움)를 그대로 유지했고, 감싸는 `styles.addBar`(하단 고정 레이아웃)는
  손대지 않았다.
- **`RecordDetailScreen.tsx`**: 로드 실패 재시도, "기록 없음" CTA(`Link`+`Button asChild`),
  케밥 메뉴 트리거(`⋯`, `ref={menuButtonRef}`, `aria-haspopup`/`aria-expanded` 그대로 유지)
  3곳 교체. **판단 지점** — 드롭다운 메뉴 안의 "삭제" 항목(`role="menuitem"`,
  `styles.menuItemDanger`)은 대상에서 제외했다: `ui.button`/`ui.buttonDanger` 계열이 아니라
  `styles.menuItem`이라는 완전히 별도의 메뉴 항목 스타일(리스트박스 옵션 형태, hover만 배경
  변경)이고, shadcn `Button`을 얹으면 프레임(테두리·패딩·높이)이 생겨 "메뉴 옵션처럼 보이는
  줄"이라는 의도한 형태가 깨진다 — QA 지시가 "삭제 관련 버튼이 있다면 `destructive` 확인"이라고
  했지만, 이 삭제는 실제 파괴적 동작을 실행하는 버튼이 아니라 `ConfirmDialog`(이미 Round 1에서
  `danger` prop → `variant="destructive"`로 마이그레이션됨)를 여는 메뉴 항목이다. 실제 파괴적
  동작 확인·실행은 `ConfirmDialog`의 `destructive` 버튼이 담당하므로 이중으로 danger 스타일을
  입힐 필요가 없다고 판단했다.
- **`guards.tsx`**: `LoadFailedBox`(`RequireCouple`/`RequireNoCouple` 양쪽에서 뜨는 전역
  컴포넌트)의 "다시 시도" 버튼 1곳 교체.
- **`PhotoField.tsx`**: "사진 추가" 버튼(`variant="outline"`, 파일 입력 트리거) 1곳 교체.
  사진 낱장의 이동(◀/▶)·삭제(×) 버튼(`styles.photoButton`)은 `ui.button` 계열이 아닌 작은
  아이콘 전용 스타일이라 대상 밖이다.
- **`MapViewScreen.tsx`**: 핀 0건 빈 상태 오버레이의 "노선도로 가기"(`Link`+`Button asChild
  variant="default"`) 1곳 교체. 캔버스 위 "전체 핀 보기"(`lineMapStyles.zoomButton`)는 지시대로
  건드리지 않았다 — `system.md` §5의 지도/노선도 위 불투명 서피스 규칙 때문에 의도적으로
  커스텀 스타일이다(§5 표에도 이미 명시돼 있음).
- **`CoupleLinkedScreen.tsx`**: "시작하기" 버튼(`variant="default"`) 1곳 교체. `InviteScreen`
  (Round 2에서 이미 마이그레이션)과 흐름이 이어지도록 같은 프리미티브를 썼다.

### 검증

- `npx tsc -b` — `button.tsx`에 `ref` prop을 추가하기 전에는 3개 파일에서 `TS2322`(ref
  prop 없음) 에러가 났다. 추가 후 통과(0 에러).
- `npm run build` — 통과. `dist/assets/index-*.js` 693.79KB(gzip 204.75KB), `index-*.css`
  311.84KB(gzip 93.58KB) — Round 2 대비 사실상 변화 없음(새 의존성 없이 같은 프리미티브
  재사용). 500KB 초과 청크 경고는 기존과 동일(코드 스플리팅은 이번 범위 밖).
- `npm run lint`(oxlint) — 통과(exit 0). 새 경고 0건. 기존 경고 4건
  (`AppShell.tsx`/`TimelineScreen.tsx`/`MapViewScreen.tsx`의 `exhaustive-deps` 3건 +
  `button.tsx`의 `only-export-components` 1건)은 이번 변경과 무관하게 이전부터 있던 것이다.
- `npm run dev`(포트 5173, 이미 떠 있던 서버)로 수정한 7개 파일 + `components/ui/button.tsx`를
  각각 직접 요청해 전부 HTTP 200을 확인했다. 7개 화면 모두 로그인(또는 커플 연결) 후에만
  보이는 화면이라 실제 로그인 세션으로 들어가 인터랙션까지 눈으로 확인하지는 못했다
  (Round 1·2와 같은 한계) — 다음 단계가 실 세션으로 스크린샷 검증을 해야 한다.
- `grep -rln "ui\.button\|ui\.buttonPrimary" src/screens src/auth` 재확인 — 남은 매치는
  `ProfileScreen.tsx`/`ConfirmDialog.tsx`/`RecordEditorScreen.tsx`/`RecordImageDialog.tsx`
  4개뿐이고, 전부 `ui.buttonRow`(버튼을 감싸는 레이아웃 wrapper 클래스)라 `ui.button`/
  `ui.buttonPrimary`(컨트롤 자체)와 무관하다 — `src/screens`·`src/auth` 전 화면에서 raw
  버튼 마이그레이션이 실제로 끝났다.

## 9.10 마이그레이션 잔여 CSS 정리 (2026-08-26, designer)

Round 1~3으로 버튼/입력이 프리미티브로 옮겨간 뒤 **아무도 참조하지 않는 셀렉터**가 남았다
(`PROGRESS.md` §6 No.4). 눈으로 훑지 않고 스크립트로 전수 조사했다: 각 `*.tsx`의
`import x from './*.module.css'` **별칭을 추출**해 `x.클래스`·`x['클래스']` 사용만 집계하고,
CSS 쪽 클래스 목록과 대조했다(`styles.foo` 문자열 grep은 `station.name` 같은 일반 프로퍼티
접근을 오탐한다 — 별칭 기준이어야 정확하다). 반대 방향(TSX가 참조하는데 CSS에 없는 클래스)도
같이 돌려 0건임을 확인했다 — 즉 집계 누락이 없다는 뜻이다.

**삭제한 것(4개 클래스 / 2개 파일)**

| 파일 | 삭제 | 대체된 곳 |
|---|---|---|
| `src/styles/ui.module.css` | `.button`(+`:hover`/`:active`/`:disabled`), `.buttonPrimary`(+3), `.buttonDanger`(+1), 그리고 `prefers-reduced-motion` 블록의 버튼 관련 규칙 | `components/ui/button.tsx`의 `outline`/`default`/`destructive` variant(모션 감소 처리 `motion-reduce:*` 포함) |
| `src/screens/records/record-editor.module.css` | `.textarea` | `components/ui/textarea.tsx`(같은 `min-height: 140px`) |

**남긴 것(지우면 안 되는 것)** — 조사에서 "버튼처럼 보이지만 살아 있는" 것들:

- `ui.buttonRow`(+`> *`): 버튼이 아니라 버튼 줄 **레이아웃**. 5개 화면이 쓴다.
- `ui.input`(+`:hover`/`:focus`/`:disabled`/`[aria-invalid]`/`::placeholder`): `StationPicker`·
  `TagField`가 여전히 쓴다 — 두 위젯은 §9.6 판단대로 shadcn 교체 대상에서 의도적으로 빠졌다.
- `ui.codeInput`, `ui.card`, `ui.centerBox`, `ui.notice` 등 나머지 21개 클래스: 전부 참조 있음.
- `line-map.module.css`(30개)·`AppShell.module.css`(8개)·`RecordCard.module.css`(13개) 등
  나머지 CSS Module 11개 파일: **참조 0건 클래스 0개**. §9.6·§9.8·§9.9가 의도적으로 제외한
  컴포넌트(AppShell 탭바·노선도 캔버스·PhotoField)의 클래스는 전부 살아 있었다.

확신이 없어 남겨둔 후보는 없다. 클래스 단위 밖(요소 셀렉터·미디어쿼리 내부 규칙)은 이번
정리 범위에서 제외했다 — 예: `record-editor.module.css`의 `.screen :is(input, textarea)`는
`Textarea` 프리미티브로 렌더된 요소에도 그대로 적용돼야 하는 살아 있는 규칙이다.
