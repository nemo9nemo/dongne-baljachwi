export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '처리하지 못했어요. 다시 시도해주세요.'
}
export function localTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('ko-KR') : '아직 없음'
}
