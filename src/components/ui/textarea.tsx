import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * `record-editor.module.css`의 `.textarea`를 옮긴 shadcn 스타일 Textarea.
 * 색·테두리·상태 규칙(focus/aria-invalid/disabled)은 `Input`과 동일하게 유지한다 —
 * 같은 폼 안에서 두 컨트롤이 다르게 보이면 안 된다. 높이·리사이즈만 textarea 전용이다.
 * 기본/hover/focus 배경을 걷어낸 근거는 `input.tsx` 주석 참고(2026-09-02).
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        // 140px: 기존 record-editor.module.css `.textarea`(일기 작성칸)와 동일한 최소 높이.
        'w-full min-h-[140px] resize-y rounded-md border border-input bg-transparent px-4 py-3 text-foreground',
        'leading-[var(--line-height-normal)] transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
        'placeholder:text-muted-foreground',
        'focus:border-[var(--color-primary)]',
        'aria-invalid:border-[var(--color-danger)] aria-invalid:bg-[var(--color-danger-soft)]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-secondary disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
