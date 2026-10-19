const CHOSUNG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/** 작성 화면과 노선도에서 같은 초성 규칙을 사용한다. */
export function toChosung(text: string): string {
  return [...text].map(char => {
    const code = char.codePointAt(0) ?? 0
    return code >= 0xac00 && code <= 0xd7a3 ? CHOSUNG[Math.floor((code - 0xac00) / 588)] : char
  }).join('')
}

export function searchStations<T extends { name: string; name_short: string; is_active: boolean }>(stations: T[], query: string): T[] {
  const normalize = (value: string) => value.toLocaleLowerCase().replaceAll(/\s/g, '')
  const needle = normalize(query)
  if (!needle) return []
  const useChosung = /[ㄱ-ㅎ]/.test(needle)
  const fold = (value: string) => useChosung ? toChosung(normalize(value)) : normalize(value)
  // 서울/서울역처럼 표기가 다른 역도 찾되, '역삼'의 역 글자는 지우지 않는다.
  const foldedNeedle = fold(needle.length > 1 && needle.endsWith('역') ? needle.slice(0, -1) : needle)
  return stations.filter(s => s.is_active && [s.name, s.name_short].some(name => fold(name).includes(foldedNeedle)))
    .sort((a, b) => Number(fold(b.name_short).startsWith(foldedNeedle)) - Number(fold(a.name_short).startsWith(foldedNeedle)) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 20)
}
