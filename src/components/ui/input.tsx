import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * `ui.module.css`의 `.input`을 Tailwind 유틸리티로 옮긴 shadcn 스타일 Input.
 *
 * `aria-invalid` 상태는 Tailwind 내장 `aria-invalid:` 변형(=[aria-invalid="true"])을 쓴다 —
 * 호출부가 문구(`.error`)를 함께 렌더하는 한 색만으로 에러를 알리지 않는다는 규칙은
 * 그대로 지켜진다(system.md §5). 비활성은 점선 테두리로 색 대비 없이도 구분된다.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'min-h-control w-full rounded-md border border-input bg-[var(--color-field)] px-4 py-3 text-foreground',
        'transition-[background-color,border-color] duration-150 ease-out',
        'placeholder:text-muted-foreground',
        // 포커스 링(:focus-visible, index.css)을 대체하는 게 아니라 보태는 신호다 — 링은
        // 그대로 바깥에 뜨고, 여기서는 바닥/테두리색만 "입력 가능"으로 바꾼다.
        'hover:bg-card focus:border-[var(--color-primary)] focus:bg-card',
        'aria-invalid:border-[var(--color-danger)] aria-invalid:bg-[var(--color-danger-soft)]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-secondary disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
