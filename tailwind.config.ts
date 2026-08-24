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
       * tokens.css의 --radius-sm/md/lg/pill 네 값을 그대로 매핑한다. 계산식을 쓰지 않는다.
       */
      borderRadius: {
        none: '0px',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-lg)',
        full: 'var(--radius-pill)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        // 날짜·통계 숫자 등 라틴/숫자 비중이 큰 자리 전용 (tokens.css 참고, 현재 적용처는
        // ProfileScreen의 디데이/통계 숫자).
        numeric: 'var(--font-numeric)',
        mono: 'var(--font-mono)',
      },
      boxShadow: {
        button: 'var(--shadow-button)',
        'button-hover': 'var(--shadow-button-hover)',
        card: 'var(--shadow-card)',
        dialog: 'var(--shadow-dialog)',
      },
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
