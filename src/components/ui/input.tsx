import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 앱의 유일한 입력 프리미티브(shadcn 스타일 Input). 옛 `ui.module.css`의 `.input`을
 * Tailwind 유틸리티로 옮긴 것이고, 원본 CSS 클래스는 2026-09-02에 삭제했다(참조 0건).
 *
 * `aria-invalid` 상태는 Tailwind 내장 `aria-invalid:` 변형(=[aria-invalid="true"])을 쓴다 —
 * 호출부가 문구(`.error`)를 함께 렌더하는 한 색만으로 에러를 알리지 않는다는 규칙은
 * 그대로 지켜진다(system.md §5). 비활성은 점선 테두리로 색 대비 없이도 구분된다.
 *
 * 2026-09-02: 기본/hover/focus의 채움(--color-field, bg-card)을 걷어냈다 — 사용자 요청.
 * 평상시 입력칸은 **테두리만으로** 자기를 드러내고, focus는 테두리색이 primary로 바뀌는 것 +
 * 전역 포커스 링(index.css)이 알린다. 남겨 둔 배경은 에러(danger-soft)와 비활성(secondary)
 * 둘뿐이다. 이 둘은 장식이 아니라 **상태를 알리는 기능적 신호**라서(각각 테두리색/점선과
 * 짝을 이루는 보조 단서) 지운다면 상태 구분이 단서 하나로 줄어든다.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'min-h-control w-full rounded-md border border-input bg-transparent px-4 py-3 text-foreground',
        'transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
        'placeholder:text-muted-foreground',
        // 포커스 링(:focus-visible, index.css)을 대체하는 게 아니라 보태는 신호다 — 링은
        // 그대로 바깥에 뜨고, 여기서는 테두리색만 "입력 가능"으로 바꾼다.
        'focus:border-[var(--color-primary)]',
        'aria-invalid:border-[var(--color-danger)] aria-invalid:bg-[var(--color-danger-soft)]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-secondary disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
