import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Radix Dialog 기반 모달 셸. `ConfirmDialog`/`DissolveCoupleDialog`/`RecordImageDialog`가
 * 각자 손으로 구현하던 접근성 배관(body 포털, 배경 `inert`, 포커스 트랩, Esc, 포커스 복귀)을
 * Radix가 대신한다 — Radix의 `FocusScope`는 키보드 Tab을 자체적으로 가로채 순환시키므로
 * `aria-hidden`이 포커스를 막지 못하는 문제(기존 주석이 `inert`를 쓴 이유)가 애초에 생기지
 * 않는다. 마운트 시점의 `document.activeElement`도 자동으로 기억했다가 언마운트 시 복원한다.
 *
 * **의도적으로 기본 시각 스타일을 두지 않는다.** 세 화면은 각자 `*.module.css`에 이미
 * 검증된 `.overlay`/`.dialog`(+ 화면별 변형) 규칙을 갖고 있고, 그 규칙엔 자식 결합자
 * (`.dialog > :last-child` 등)·미디어 쿼리까지 걸려 있다. 여기서 Tailwind 기본 클래스를
 * 얹으면 같은 우선순위의 클래스 두 벌이 우연한 로드 순서로 겨루게 된다 — 대신 각 화면이
 * 기존 CSS Module 클래스를 `className`으로 그대로 넘겨 시각 결과를 1:1 유지한다. 이 컴포넌트가
 * 맡는 건 오직 Radix의 동작(포털·포커스·Esc)이다.
 */
const Dialog = DialogPrimitive.Root
const DialogPortal = DialogPrimitive.Portal
const DialogTitle = DialogPrimitive.Title

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn(className)} {...props} />
}

function DialogContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Content className={cn(className)} {...props} />
}

export { Dialog, DialogPortal, DialogOverlay, DialogContent, DialogTitle }
