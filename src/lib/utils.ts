import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui 프리미티브가 공통으로 쓰는 클래스 병합 헬퍼.
 * clsx로 조건부 클래스를 모으고, tailwind-merge로 같은 속성을 가리키는 유틸리티 클래스의
 * 충돌(예: `p-4 p-2`)을 마지막 값이 이기도록 정리한다.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
