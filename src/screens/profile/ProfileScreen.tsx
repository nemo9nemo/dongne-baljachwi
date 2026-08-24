import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '../../auth/session-context'
import { supabase, isNetworkFailure } from '../../lib/supabase'
import { DissolveCoupleDialog } from '../../components/DissolveCoupleDialog'
import { useLineMapData } from '../lines/line-map-data'
import { loadStationLines } from '../../lib/station-master'
import type { StationLineRow } from '../../lib/station-master'
import { recommendStations } from '../../lib/station-recommendation'
import type { RecommendedStation } from '../../lib/station-recommendation'
import { todayLocal } from '../../lib/format-date'
import styles from './profile.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 프로필 (`docs/specs/09-couple-profile.md`) — 요약 통계 · 안 가본 역 추천 · 커플 설정.
 *
 * 통계·추천은 `couple_summary` 뷰(§4.2)를 새로 만들지 않았다. `couple_station_visits`는
 * 이미 03(노선도)/04(역상세)/07(지도)과 `useLineMapData()`로 공유 중인데, 그 `visit_count`를
 * 전부 더하면 정확히 총 데이트 수다(기록 1건 = station_id 1개에만 속하므로). 방문 역 수는
 * 행 개수 그대로다. 뷰 하나 늘리는 것보다 이미 있는 캐시로 충분했다.
 *
 * 추천은 §4.3 계약 그대로 클라이언트에서 계산한다 (`station-recommendation.ts`).
 */

/** F-06(01)의 display_name 길이 제한과 동일 */
const NAME_MIN = 1
const NAME_MAX = 12

/** `a`(YYYY-MM-DD) 기준으로 `b`가 며칠 뒤인지. 음수면 `b`가 더 과거다 */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = new Date(ay ?? 0, (am ?? 1) - 1, ad ?? 0).getTime()
  const db = new Date(by ?? 0, (bm ?? 1) - 1, bd ?? 0).getTime()
  return Math.round((db - da) / 86_400_000)
}

/** F-02~F-05: 사귄 날을 1일째로 센다. 미래 날짜면 D-N (Could, 방어적으로 포함) */
function ddayLabel(startedOn: string): string {
  const diff = daysBetween(startedOn, todayLocal())
  return diff < 0 ? `D${diff}` : `함께한 지 ${diff + 1}일째`
}

/** F-10: 0보다 크고 0.1% 미만이면 "0.1% 미만" — 700역 중 1역이 "0%"로 보이면 안 된다 */
function coverageLabel(visited: number, denominator: number): string {
  if (denominator === 0) return '-'
  const pct = (visited / denominator) * 100
  if (pct > 0 && pct < 0.1) return '0.1% 미만'
  return `${pct.toFixed(1)}%`
}

export function ProfileScreen() {
  const session = useSession()
  const { master, visits, reloadVisits } = useLineMapData()
  const [dissolveOpen, setDissolveOpen] = useState(false)
  const [lineLinks, setLineLinks] = useState<StationLineRow[]>([])
  const [linksReady, setLinksReady] = useState(false)

  useEffect(() => {
    if (master.kind !== 'ready') return
    void loadStationLines(master.master.version).then(
      (rows) => {
        setLineLinks(rows)
        setLinksReady(true)
      },
      () => setLinksReady(true),
    )
  }, [master])

  // ── 통계 (F-06~F-12) ────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (visits.kind !== 'ready' || master.kind !== 'ready') return null
    const totalRecords = visits.rows.reduce((sum, row) => sum + row.visit_count, 0)
    const visitedStationCount = visits.rows.length

    // F-08/F-09: 분모는 in_mvp_scope && is_active 노선에 속한 is_active 역의 distinct 개수.
    const mvpLineIds = new Set(
      master.master.lines.filter((line) => line.in_mvp_scope && line.is_active).map((line) => line.id),
    )
    const stationById = new Map(master.master.stations.map((s) => [s.id, s]))
    const mvpStationIds = new Set(
      lineLinks
        .filter((link) => mvpLineIds.has(link.line_id))
        .map((link) => link.station_id)
        .filter((id) => stationById.get(id)?.is_active === true),
    )
    return { totalRecords, visitedStationCount, denominator: mvpStationIds.size }
  }, [visits, master, lineLinks])

  // ── 추천 (F-13~F-21) ────────────────────────────────────────────────
  const visitedStationIds = useMemo(
    () => new Set(visits.kind === 'ready' ? visits.rows.map((row) => row.station_id) : []),
    [visits],
  )

  const recommendations: RecommendedStation[] | null = useMemo(() => {
    if (master.kind !== 'ready' || visits.kind !== 'ready' || !linksReady) return null
    const coupleId = session.couple?.id
    if (coupleId === undefined) return null
    // F-17: 시드 = couple_id + 오늘(KST). 같은 날 새로고침해도 같은 추천, 다음 날은 달라진다.
    return recommendStations({
      stations: master.master.stations,
      lines: master.master.lines,
      stationLines: lineLinks,
      visitedStationIds,
      seed: `${coupleId}-${todayLocal()}`,
    })
  }, [master, visits, linksReady, lineLinks, visitedStationIds, session.couple?.id])

  // ── 설정: 이름 변경 (F-22) ──────────────────────────────────────────
  const [nameEditing, setNameEditing] = useState(false)
  const [nameInput, setNameInput] = useState(session.displayName ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    if (!nameEditing) setNameInput(session.displayName ?? '')
  }, [session.displayName, nameEditing])

  async function saveName() {
    const trimmed = nameInput.trim()
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setNameError(`이름은 ${NAME_MIN}~${NAME_MAX}자로 입력해주세요.`)
      return
    }
    if (session.userId === null) return
    setNameSaving(true)
    setNameError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', session.userId)
    setNameSaving(false)
    if (error !== null) {
      setNameError(isNetworkFailure(error) ? '네트워크 연결을 확인해주세요.' : '저장하지 못했어요. 다시 시도해주세요.')
      return
    }
    await session.reload()
    setNameEditing(false)
  }

  // ── 설정: 사귄 날 수정 (F-23) ───────────────────────────────────────
  const [dateEditing, setDateEditing] = useState(false)
  const [dateInput, setDateInput] = useState(session.couple?.startedOn ?? '')
  const [dateSaving, setDateSaving] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)
  const today = todayLocal()

  useEffect(() => {
    if (!dateEditing) setDateInput(session.couple?.startedOn ?? '')
  }, [session.couple?.startedOn, dateEditing])

  async function saveStartedOn() {
    if (session.couple === null) return
    if (dateInput === '' || dateInput > today) {
      setDateError('사귄 날짜는 오늘 이전이어야 해요.')
      return
    }
    setDateSaving(true)
    setDateError(null)
    const { error } = await supabase
      .from('couples')
      .update({ started_on: dateInput })
      .eq('id', session.couple.id)
    setDateSaving(false)
    if (error !== null) {
      setDateError(
        isNetworkFailure(error)
          ? '네트워크 연결을 확인해주세요.'
          : error.code === '23514'
            ? '사귄 날짜는 오늘 이전이어야 해요.'
            : '저장하지 못했어요. 다시 시도해주세요.',
      )
      return
    }
    await session.reload()
    setDateEditing(false)
  }

  return (
    <div className={ui.screen}>
      <h1 className={ui.title}>프로필</h1>

      <div className={ui.card}>
        <p className={ui.label}>나</p>
        {nameEditing ? (
          <div className={styles.editRow}>
            <label className="srOnly" htmlFor="profile-name">
              내 이름
            </label>
            <Input
              id="profile-name"
              value={nameInput}
              maxLength={NAME_MAX}
              disabled={nameSaving}
              autoFocus
              onChange={(event) => setNameInput(event.target.value)}
            />
            <div className={ui.buttonRow}>
              <Button
                type="button"
                disabled={nameSaving}
                onClick={() => {
                  setNameEditing(false)
                  setNameError(null)
                }}
              >
                취소
              </Button>
              <Button type="button" variant="default" disabled={nameSaving} onClick={() => void saveName()}>
                {nameSaving ? '저장하는 중…' : '저장'}
              </Button>
            </div>
            {nameError !== null && (
              <p className={ui.error} role="alert">
                {nameError}
              </p>
            )}
          </div>
        ) : (
          <p className={styles.editableRow}>
            {session.displayName ?? '이름 없음'}
            <button type="button" className={styles.linkButton} onClick={() => setNameEditing(true)}>
              변경
            </button>
          </p>
        )}

        <p className={ui.label}>상대</p>
        {session.partner === null ? (
          // F-27: 상대 미합류면 이름 자리에 대기 상태와 코드 진입점을 둔다.
          <p>
            상대 초대 대기 중 · <Link to="/invite">초대 코드 보기</Link>
          </p>
        ) : (
          <p>{session.partner.displayName}</p>
        )}

        {session.couple !== null && (
          <>
            <p className={ui.label}>사귄 날</p>
            {dateEditing ? (
              <div className={styles.editRow}>
                <label className="srOnly" htmlFor="profile-started-on">
                  사귄 날
                </label>
                <Input
                  id="profile-started-on"
                  type="date"
                  value={dateInput}
                  max={today}
                  disabled={dateSaving}
                  onChange={(event) => setDateInput(event.target.value)}
                />
                <div className={ui.buttonRow}>
                  <Button
                    type="button"
                    disabled={dateSaving}
                    onClick={() => {
                      setDateEditing(false)
                      setDateError(null)
                    }}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={dateSaving}
                    onClick={() => void saveStartedOn()}
                  >
                    {dateSaving ? '저장하는 중…' : '저장'}
                  </Button>
                </div>
                {dateError !== null && (
                  <p className={ui.error} role="alert">
                    {dateError}
                  </p>
                )}
              </div>
            ) : (
              <p className={styles.editableRow}>
                {/* F-03/F-04: 디데이는 클라이언트가 KST 기준으로 계산한다 */}
                <span>
                  {ddayLabel(session.couple.startedOn)}
                  <span className={ui.hint}> · {session.couple.startedOn}부터</span>
                </span>
                <button type="button" className={styles.linkButton} onClick={() => setDateEditing(true)}>
                  변경
                </button>
              </p>
            )}
          </>
        )}
      </div>

      <div className={ui.card}>
        <p className={ui.sectionTitle}>통계</p>
        {visits.kind === 'failed' ? (
          <div className={styles.editRow}>
            <p className={ui.error}>통계를 불러오지 못했어요.</p>
            <Button type="button" onClick={reloadVisits}>
              다시 시도
            </Button>
          </div>
        ) : stats === null ? (
          <div className={styles.statSkeleton} aria-hidden="true" />
        ) : (
          <ul className={styles.statList}>
            <li>
              <span className={styles.statLabel}>총 데이트 수</span>
              <span className={styles.statValue}>{stats.totalRecords}회</span>
            </li>
            <li>
              <span className={styles.statLabel}>방문 역 수</span>
              <span className={styles.statValue}>{stats.visitedStationCount}곳</span>
            </li>
            <li>
              <span className={styles.statLabel}>커버리지</span>
              <span className={styles.statValue}>
                {coverageLabel(stats.visitedStationCount, stats.denominator)}
                {/* F-11: 분모를 함께 노출해 규모 감각을 준다 */}
                {stats.denominator > 0 && (
                  <span className={ui.hint}>
                    {' '}
                    ({stats.visitedStationCount} / {stats.denominator}역)
                  </span>
                )}
              </span>
            </li>
          </ul>
        )}
      </div>

      {master.kind === 'ready' && (
        <div className={ui.card}>
          <p className={ui.sectionTitle}>다음에 가볼만한 역</p>
          {recommendations === null ? (
            <div className={styles.chipSkeleton} aria-hidden="true" />
          ) : recommendations.length === 0 ? (
            <p className={ui.subtitle}>수도권을 모두 다녀왔어요!</p>
          ) : (
            <ul className={styles.chipList}>
              {recommendations.map((rec) => (
                <li key={rec.stationId}>
                  <Link
                    to={`/records/new?stationId=${rec.stationId}`}
                    className={styles.chip}
                    aria-label={`${rec.name.endsWith('역') ? rec.name : `${rec.name}역`} 기록 작성하기`}
                  >
                    <span className={styles.chipName}>{rec.name}</span>
                    {rec.lines[0] !== undefined && (
                      <span className={styles.chipLine}>{rec.lines[0].name}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button type="button" onClick={() => void session.signOut()}>
        로그아웃
      </Button>

      {/* F-26: 파괴적 항목은 목록 최하단에 시각적으로 분리해 배치한다 (오탭 방지). */}
      <hr />
      <Button type="button" variant="destructive" onClick={() => setDissolveOpen(true)}>
        커플 연결 해제
      </Button>

      {dissolveOpen && <DissolveCoupleDialog onClose={() => setDissolveOpen(false)} />}
    </div>
  )
}
