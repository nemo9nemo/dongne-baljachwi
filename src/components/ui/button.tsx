import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * `ui.module.css`의 `.button`/`.buttonPrimary`/`.buttonDanger`를 Tailwind 유틸리티로
 * 옮긴 shadcn 스타일 Button. 값은 전부 `tailwind.config.ts`를 거쳐 tokens.css를
 * 참조한다 — 여기서 색·반경 리터럴을 새로 쓰지 않는다.
 *
 * 접근성 규칙(`docs/design/system.md` §5)을 그대로 지킨다: 비활성은 opacity가 아니라
 * 채움 제거 + muted 텍스트로 표현하고, 이동 효과는 `motion-reduce:`로 끈다.
 */
const buttonVariants = cva(
  [
    'inline-flex min-h-control items-center justify-center rounded-md px-5 text-center font-medium',
    'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none',
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        /** 채움. 진입점의 주 동작 하나에만 쓴다(ui.module.css `.buttonPrimary`와 동일). */
        default: [
          'border border-transparent bg-primary font-bold text-primary-foreground shadow-button',
          'hover:-translate-y-px hover:bg-[var(--color-primary-hover)] hover:shadow-button-hover',
          'active:translate-y-px active:shadow-button',
          'disabled:bg-[var(--color-primary-soft)] disabled:text-muted-foreground',
        ].join(' '),
        /** 윤곽. 기본값(`.button`) — 보조 동작 전반. */
        outline: [
          'border border-input bg-card text-foreground',
          'hover:bg-secondary active:translate-y-px',
          'disabled:border-input disabled:bg-secondary disabled:text-muted-foreground',
        ].join(' '),
        /**
         * 되돌릴 수 없는 동작(삭제·연결 해제). primary와 같은 색(검정/흰색)이므로
         * **색이 아니라 윤곽→채움 형태 전환**으로 구분한다(system.md §2 "채움 vs 윤곽").
         */
        destructive: [
          'border border-[var(--color-danger)] bg-card text-[var(--color-danger)]',
          'hover:border-[var(--color-danger-hover)] hover:bg-[var(--color-danger-hover)] hover:text-primary-foreground',
          'active:translate-y-px',
          'disabled:border-input disabled:bg-secondary disabled:text-muted-foreground',
        ].join(' '),
      },
    },
    defaultVariants: {
      variant: 'outline',
    },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Radix `Slot`으로 렌더한다 — 링크 등 다른 요소에 버튼 스타일만 입힐 때 쓴다 */
    asChild?: boolean
  }

function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, className }))} {...props} />
}

export { Button, buttonVariants }
