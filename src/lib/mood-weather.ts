import type { Mood, Weather } from './database.types'

/**
 * 감정·날씨 슬러그 ↔ 이모지·라벨 (05 F-11/F-12, PRD §5.2 이모지 순서 그대로).
 *
 * 원래 `RecordEditorScreen`에만 있었는데 `RecordDetailScreen`(06 F-01)도 같은 표시가
 * 필요해져 두 번째 사용처가 생겨서 꺼냈다. 저장 값은 슬러그이고 이모지는 표시 전용이다
 * (F-14) — 두 화면이 각자 매핑을 들고 있으면 한쪽만 감정이 추가될 때 어긋난다.
 */
export const MOODS: readonly { slug: Mood; emoji: string; label: string }[] = [
  { slug: 'happy', emoji: '😊', label: '기쁨' },
  { slug: 'love', emoji: '😍', label: '사랑' },
  { slug: 'excited', emoji: '😆', label: '설렘' },
  { slug: 'calm', emoji: '😌', label: '편안' },
  { slug: 'sad', emoji: '😢', label: '슬픔' },
]

export const WEATHERS: readonly { slug: Weather; emoji: string; label: string }[] = [
  { slug: 'sunny', emoji: '☀️', label: '맑음' },
  { slug: 'cloudy', emoji: '☁️', label: '흐림' },
  { slug: 'rainy', emoji: '🌧️', label: '비' },
  { slug: 'snowy', emoji: '❄️', label: '눈' },
  { slug: 'windy', emoji: '🌬️', label: '바람' },
]

/**
 * 앱 밖에서 들어온 값(localStorage 초안, `location.state`)을 슬러그로 좁힌다.
 * 목록이 곧 DB enum이므로(00 §4.5) 여기 없는 값은 저장해도 서버가 거부한다 —
 * 캐스팅으로 통과시키면 실패가 저장 시점까지 미뤄진다.
 */
export function isMood(value: unknown): value is Mood {
  return MOODS.some((item) => item.slug === value)
}

export function isWeather(value: unknown): value is Weather {
  return WEATHERS.some((item) => item.slug === value)
}
