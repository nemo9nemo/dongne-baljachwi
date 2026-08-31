import { Link } from 'react-router-dom'
import { formatVisitedOn } from '../lib/format-date'
import { MOODS, WEATHERS } from '../lib/mood-weather'
import type { RecordCard as RecordCardData } from '../lib/record-card-query'
import styles from './RecordCard.module.css'

/**
 * 기록 목록 카드 (04-station-detail.md §4.1/§7, 08-timeline.md F-02).
 *
 * 역 상세(04)와 타임라인(08)이 **같은 shape·같은 표현**을 쓰기로 정한 컴포넌트다.
 * 차이는 역명 노출 여부뿐이라 `stationName`을 옵셔널로 둔다 — 04는 이미 역이 정해진
 * 화면이라 안 넘기고, 08은 여러 역이 섞이므로 넘긴다.
 */
type Props = {
  card: RecordCardData
  authorName: string
  /**
   * 이 기록의 역명. 화면에 링크로 **보여줄지**는 `stationHref` 유무가 정한다 —
   * 04는 이미 역이 정해진 화면이라 링크를 숨기지만, 접근 가능한 이름(04 AC-13)과
   * 06으로 넘기는 카드 요약(06 AC-15)에는 역명이 필요해서 값 자체는 항상 받는다.
   */
  stationName: string
  /** 넘기면 역명을 별도 링크로 보여준다 (08 F-06). 04는 안 넘긴다 */
  stationHref?: string
  /**
   * 06이 삭제·"기록 없음" 후 돌아갈 곳 (06 §9 진입 출처 추적, AC-09).
   * 쿼리스트링까지 포함한 전체 경로여야 한다 — 타임라인은 태그 필터가 URL에 있다.
   */
  backTo: string
}

export function RecordCard({ card, authorName, stationName, stationHref, backTo }: Props) {
  const { dateLabel } = formatVisitedOn(card.visitedOn)
  const moodMeta = card.mood === null ? null : (MOODS.find((item) => item.slug === card.mood) ?? null)
  const weatherMeta =
    card.weather === null ? null : (WEATHERS.find((item) => item.slug === card.weather) ?? null)
  const extraTagCount = card.totalTagCount - card.tags.length

  // §6 접근성: "2026년 8월 11일 홍대입구 기록, 설렘, 맑음, 사진 2장" 형태로 구성한다.
  // 링크 전체에 aria-label을 걸면 하위 텍스트(태그·작성자)가 스크린리더에서 사라지므로
  // 여기서 함께 문장에 포함시킨다 — 화면에는 각자 제자리에서 보이고, 접근성 트리에서만
  // 하나의 문장으로 합쳐진다.
  const labelParts = [
    `${dateLabel} ${stationName} 기록`,
    moodMeta?.label,
    weatherMeta?.label,
    card.photoCount > 0 ? `사진 ${card.photoCount}장` : undefined,
    card.tags.length > 0 ? `태그 ${card.tags.join(', ')}` : undefined,
    `${authorName}이(가) 남김`,
  ].filter((part): part is string => part !== undefined)

  return (
    <li className={styles.item}>
      {stationHref !== undefined && (
        <Link to={stationHref} className={styles.stationLink}>
          {stationName}
        </Link>
      )}
      <Link
        to={`/records/${card.id}`}
        className={styles.card}
        aria-label={labelParts.join(', ')}
        // 06 §6 "첫 픽셀"/AC-15: 상세가 조회를 마치기 전에 카드가 이미 아는 값으로 헤더를
        // 그리게 한다. 사진·일기까지 넘기지 않는 이유는 그 둘이 상세에서 어차피 전문으로
        // 다시 필요하고, history state는 세션 저장소에 직렬화되어 커질수록 비싸기 때문이다.
        state={{
          from: backTo,
          card: {
            stationName,
            visitedOn: card.visitedOn,
            mood: card.mood,
            weather: card.weather,
          },
        }}
      >
        {card.coverPhoto !== null && (
          <div
            className={styles.thumbWrap}
            style={{ aspectRatio: `${card.coverPhoto.width} / ${card.coverPhoto.height}` }}
          >
            {card.coverPhoto.url === null ? (
              <div className={styles.thumbFallback} aria-hidden="true" />
            ) : (
              <img className={styles.thumb} src={card.coverPhoto.url} alt="" />
            )}
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={styles.date}>{dateLabel}</span>
            {moodMeta !== null && <span aria-hidden="true">{moodMeta.emoji}</span>}
            {weatherMeta !== null && <span aria-hidden="true">{weatherMeta.emoji}</span>}
          </div>

          {card.noteExcerpt !== null && card.noteExcerpt !== '' && (
            <p className={styles.excerpt}>{card.noteExcerpt}</p>
          )}

          {card.tags.length > 0 && (
            <div className={styles.tags} aria-hidden="true">
              {card.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  #{tag}
                </span>
              ))}
              {/* F-11 (04): 태그가 3개를 넘으면 "+N" */}
              {extraTagCount > 0 && <span className={styles.tag}>+{extraTagCount}</span>}
            </div>
          )}

          <span className={styles.author} aria-hidden="true">
            {authorName}
          </span>
        </div>
      </Link>
    </li>
  )
}
