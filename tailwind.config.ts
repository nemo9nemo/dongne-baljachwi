import type { Config } from 'tailwindcss'

/*
 * shadcn/ui 프리미티브(Button, Dialog, Input …)가 참조하는 Tailwind 테마.
 *
 * 색·간격·반경·그림자 값을 여기서 새로 정의하지 않는다 — 전부 `src/styles/tokens.css`의
 * CSS 변수를 가리키기만 한다(디자이너 인수인계 문서
 * `docs/design/redesign-resend-reference.md` §4, §7). 값을 바꾸려면 tokens.css를 고친다.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
      /*
       * shadcn 기본 테마는 borderRadius를 `calc(var(--radius) - 2px)` 같은 파생 공식으로
       * 만드는데, 이 프로젝트는 "반경도 유한한 단계만"이라는 원칙이 있어(system.md §4)
       * tokens.css 값을 그대로 매핑한다. 계산식을 쓰지 않는다.
       *
       * 2026-08-31 기아 재브랜딩: 반경은 두 개뿐이다 — 컨트롤 0px, 카드 15px.
       * sm/DEFAULT/md는 전부 컨트롤(0), lg/xl은 카드(15px)를 가리킨다. pill(999px)은
       * 브랜드에서 제거됐고, `rounded-full`은 진짜 원형 도형용 --radius-circle로 남긴다.
       */
      borderRadius: {
        none: '0px',
        sm: 'var(--radius-control)',
        DEFAULT: 'var(--radius-control)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-card)',
        xl: 'var(--radius-card)',
        full: 'var(--radius-circle)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        // 날짜·통계 숫자 등 라틴/숫자 비중이 큰 자리 전용 (tokens.css 참고, 현재 적용처는
        // ProfileScreen의 디데이/통계 숫자).
        numeric: 'var(--font-numeric)',
        mono: 'var(--font-mono)',
      },
      /* boxShadow 확장은 없다 — 기아 재브랜딩으로 `--shadow-*` 토큰 자체를 삭제했다
         ("box-shadow: none 전체", 깊이는 배경 대비와 1px 경계가 낸다). 그림자가 필요해
         보이는 자리가 생기면 그건 대비 설계가 부족하다는 신호다. */
      spacing: {
        // 컨트롤 공통 치수 — ui.module.css가 이미 쓰는 값과 동일 (system.md §4).
        control: 'var(--control-height)',
        touch: 'var(--touch-target)',
      },
      zIndex: {
        dialog: 'var(--z-dialog)',
      },
    },
  },
  plugins: [],
} satisfies Config
