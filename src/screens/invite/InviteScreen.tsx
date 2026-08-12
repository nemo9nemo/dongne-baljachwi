import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { supabase } from '../../lib/supabase'
import { failureMessage, issueInvite } from '../../lib/couple-rpc'
import { formatInviteCode } from '../../lib/invite-code'
import { readStateString } from '../../lib/router-state'
import ui from '../../styles/ui.module.css'

type Invite = { code: string; expiresAt: string }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; invite: Invite }
  /** 유효한 코드가 없다(만료·사용됨·무효화). 재발급만 하면 된다 */
  | { kind: 'empty' }
  | { kind: 'error' }

function formatRemaining(expiresAt: string): string {
  const totalMinutes = Math.floor((Date.parse(expiresAt) - Date.now()) / 60000)
  if (totalMinutes <= 0) return '만료됨'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}시간 ${minutes}분 남음` : `${minutes}분 남음`
}

/**
 * 초대 코드 표시 / 복사 / 재발급 (F-08, F-18, 01 §2.1-7).
 *
 * 온보딩에서 커플을 만든 직후에도, 나중에 "상대 초대 대기 중" 배너에서도 같은 화면으로 온다.
 * 진입 경로는 안내 문구만 다르게 한다.
 */
export function InviteScreen() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const justCreated = readStateString(location.state, 'origin') === 'create'
  // 커플 생성 직후에는 `create_couple`이 돌려준 코드를 그대로 들고 넘어온다.
  // 이때는 세션의 커플 정보가 아직 갱신되기 전일 수 있으므로, 이 값이 화면을 띄우는 근거가 된다.
  const seededCode = readStateString(location.state, 'code')
  const seededExpiresAt = readStateString(location.state, 'expiresAt')
  const seeded = seededCode !== null && seededExpiresAt !== null

  const [state, setState] = useState<LoadState>(() =>
    seededCode !== null && seededExpiresAt !== null
      ? { kind: 'ready', invite: { code: seededCode, expiresAt: seededExpiresAt } }
      : { kind: 'loading' },
  )
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  // 남은 시간 문자열을 다시 계산하게 만드는 값. 값 자체는 쓰지 않는다.
  const [, setTick] = useState(0)

  const coupleId = session.couple?.id ?? null
  const isFull = session.members.length >= 2

  const load = useCallback(async () => {
    if (coupleId === null) return
    setState({ kind: 'loading' })
    // RLS가 이미 커플 단위로 막지만, 클라이언트에서도 격리 조건을 명시한다 (00 §1).
    const { data, error } = await supabase
      .from('couple_invites')
      .select('code, expires_at')
      .eq('couple_id', coupleId)
      .is('consumed_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setState({ kind: 'error' })
      return
    }
    setState(
      data === null
        ? { kind: 'empty' }
        : { kind: 'ready', invite: { code: data.code, expiresAt: data.expires_at } },
    )
  }, [coupleId])

  // 최초 조회는 딱 한 번만 한다. 넘겨받은 코드가 있으면 아예 하지 않는다.
  // (state.kind를 의존성에 넣으면 조회 → 상태 변경 → 조회 루프가 된다)
  const initialLoadDone = useRef(seeded)
  useEffect(() => {
    if (isFull || coupleId === null || initialLoadDone.current) return
    initialLoadDone.current = true
    void load()
  }, [isFull, coupleId, load])

  // 유효기간이 72시간(F-11)이라 1초마다 다시 그릴 이유가 없다. 분 단위 표시에 맞춰
  // 1분마다만 리렌더한다 — 1초 간격이면 화면 전체가 하루에 수만 번 다시 그려진다.
  useEffect(() => {
    if (state.kind !== 'ready') return
    const timer = window.setInterval(() => setTick((prev) => prev + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [state.kind])

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopyNotice('코드를 복사했어요.')
    } catch {
      // clipboard API는 보안 컨텍스트(https/localhost)에서만 동작한다. 실패하면
      // 사용자가 직접 선택해 복사할 수 있도록 안내만 한다.
      setCopyNotice('복사에 실패했어요. 코드를 길게 눌러 직접 복사해주세요.')
    }
  }

  async function handleIssue() {
    if (issuing) return
    setIssuing(true)
    setIssueError(null)
    const result = await issueInvite()
    if (!result.ok) {
      setIssueError(failureMessage(result.failure))
      setIssuing(false)
      return
    }
    setState({
      kind: 'ready',
      invite: { code: result.data.code, expiresAt: result.data.expires_at },
    })
    setCopyNotice(null)
    setIssuing(false)
  }

  // 커플이 없는 사람이 URL로 직접 들어온 경우. 방금 만든 코드를 들고 온 경우는 예외다
  // (세션 갱신이 아직 끝나지 않았을 뿐이다).
  if (session.couple === null && !seeded) return <Navigate to="/onboarding" replace />

  // F-16 / COUPLE_ALREADY_FULL: 2명이 찬 커플에서는 코드 발급 자체가 불가능하다.
  if (isFull) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>이미 두 사람이 연결되어 있어요</h1>
        <p className={ui.subtitle}>더 이상 초대 코드가 필요하지 않아요.</p>
        <button
          type="button"
          className={`${ui.button} ${ui.buttonPrimary}`}
          onClick={() => navigate('/lines', { replace: true })}
        >
          돌아가기
        </button>
      </div>
    )
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <h1 className={ui.title}>
          {justCreated ? '커플이 만들어졌어요' : '초대 코드'}
        </h1>
        <p className={ui.subtitle}>
          이 코드를 상대에게 보내주세요. 상대가 코드를 입력하면 연결돼요.
        </p>
      </header>

      {state.kind === 'loading' && (
        <p role="status" aria-live="polite">
          코드를 불러오는 중…
        </p>
      )}

      {state.kind === 'error' && (
        <div className={ui.card}>
          <p className={ui.error}>코드를 불러오지 못했어요.</p>
          <button type="button" className={ui.button} onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}

      {state.kind === 'empty' && (
        <div className={ui.card}>
          <p>유효한 코드가 없어요. 새로 발급해주세요.</p>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className={ui.card}>
          {/* 전화로 불러주는 경우를 위해 큰 글자로 보여준다 (01 §6). */}
          <p className={ui.code}>{formatInviteCode(state.invite.code)}</p>
          <p className={ui.subtitle}>{formatRemaining(state.invite.expiresAt)}</p>
          <button
            type="button"
            className={`${ui.button} ${ui.buttonPrimary}`}
            onClick={() => void handleCopy(state.invite.code)}
          >
            코드 복사
          </button>
          {copyNotice !== null && (
            <p className={ui.subtitle} role="status" aria-live="polite">
              {copyNotice}
            </p>
          )}
        </div>
      )}

      {issueError !== null && (
        <p className={ui.errorBanner} role="alert">
          {issueError}
        </p>
      )}

      <div className={ui.field}>
        <button
          type="button"
          className={ui.button}
          disabled={issuing || state.kind === 'loading'}
          onClick={() => void handleIssue()}
        >
          {issuing ? '발급하는 중…' : '새 코드 발급'}
        </button>
        {/* F-08: 커플당 유효 코드는 1개다. 재발급이 곧 이전 코드 폐기라는 걸 미리 알린다. */}
        <p className={ui.hint}>새로 발급하면 이전 코드는 바로 쓸 수 없게 돼요.</p>
      </div>

      <button
        type="button"
        className={ui.button}
        onClick={() => navigate('/lines', { replace: true })}
      >
        {/* F-17: 상대가 합류하기 전에도 앱을 그대로 쓸 수 있다. */}
        {justCreated ? '먼저 시작하기' : '돌아가기'}
      </button>
    </div>
  )
}
