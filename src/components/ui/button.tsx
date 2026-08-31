import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * shadcn 스타일 Button. 값은 전부 `tailwind.config.ts`를 거쳐 tokens.css를 참조한다 —
 * 여기서 색·반경 리터럴을 새로 쓰지 않는다.
 *
 * 2026-08-31 기아 재브랜딩:
 *  - 형태: `rounded-md`가 이제 0px다(--radius-control). 패딩은 기아 버튼 규격 16/24px
 *    (`min-h-control`=48px + `px-6`), 라벨은 Bold 하나로 통일했다(굵기 2단계 원칙).
 *  - 그림자·부양 제거: `shadow-button`/`-translate-y-px`를 전부 걷어냈다. 이 시스템의
 *    깊이는 그림자가 아니라 채움 대비(차콜 vs 화이트)가 낸다. 남은 상태 변화는 색뿐이라
 *    `prefers-reduced-motion`에서 끌 이동 효과 자체가 없어졌다(transition-none만 남긴다).
 *  - 비활성: 회색으로 바꾸지 않고 **브랜드 색을 페이드**한다(--color-primary-disabled,
 *    차콜 30% 합성을 불투명 값으로 고정). 라벨은 채움 위 흰색/차콜 그대로라 대비가
 *    라이트 4.91:1 / 다크 4.82:1로 계산상 확정된다 — 반투명 위 글자를 만들지 않는다는
 *    기존 접근성 규칙(system.md §5)을 지키면서 브랜드 톤을 유지하는 방식이다.
 */
const buttonVariants = cva(
  [
    // `no-underline`: asChild로 <a>를 감쌀 때(빈 상태 CTA 등) index.css의 전역 링크 밑줄이
    // 버튼 라벨에 그어지는 걸 막는다. 버튼은 형태 자체가 클릭 대상임을 알리므로 밑줄이 필요 없다.
    'inline-flex min-h-control items-center justify-center rounded-md px-6 text-center font-bold no-underline',
    'transition-[background-color,border-color,color] duration-150 ease-out',
    'disabled:pointer-events-none disabled:cursor-not-allowed',
    'motion-reduce:transition-none',
  ].join(' '),
  {
    variants: {
      variant: {
        /** 채움. 진입점의 주 동작 하나에만 쓴다. */
        default: [
          'border border-transparent bg-primary text-primary-foreground',
          'hover:bg-[var(--color-primary-hover)]',
          'disabled:border-transparent disabled:bg-[var(--color-primary-disabled)] disabled:text-primary-foreground',
        ].join(' '),
        /** 윤곽. 기본값 — 보조 동작 전반. */
        outline: [
          'border border-input bg-card text-foreground',
          'hover:bg-secondary',
          'disabled:border-input disabled:bg-secondary disabled:text-muted-foreground',
        ].join(' '),
        /**
         * 되돌릴 수 없는 동작(삭제·연결 해제). primary와 같은 차콜이므로
         * **색이 아니라 윤곽→채움 형태 전환**으로 구분한다(system.md §2 "채움 vs 윤곽").
         */
        destructive: [
          'border border-[var(--color-danger)] bg-card text-[var(--color-danger)]',
          'hover:border-[var(--color-danger-hover)] hover:bg-[var(--color-danger-hover)] hover:text-primary-foreground',
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
    // React 19부터 함수 컴포넌트가 forwardRef 없이 ref를 일반 prop으로 받을 수 있다.
    // IntersectionObserver 타깃(무한 스크롤 "더 보기")·포커스 복귀 대상(케밥 메뉴 트리거)처럼
    // DOM 노드 참조가 필요한 호출부가 있어 명시적으로 열어 둔다.
    ref?: React.Ref<HTMLButtonElement>
  }

function Button({ className, variant, asChild = false, ref, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} className={cn(buttonVariants({ variant, className }))} {...props} />
}

export { Button, buttonVariants }
