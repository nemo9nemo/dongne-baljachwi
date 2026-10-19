import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, setRecordScope } from '../lib/supabase'
import { todayKst } from '../lib/format-date'
import { useRevalidation } from '../lib/revalidation'
import { clearAppStorage } from '../lib/app-storage'
import { scopeToCouple } from '../lib/screen-cache'
import { SessionContext } from './session-context'
import type { CoupleMember, CoupleSummary, SessionValue } from './session-context'

type AuthState = {
  status: SessionValue['status']
  userId: string | null
  email: string | null
}

type CoupleState = {
  ownerId: string | null
  sharedCouple: CoupleSummary | null
  spaces: NonNullable<SessionValue['spaces']>
  /** 서버 조회가 끝났는지. false인 동안 "커플 없음"으로 단정하면 안 된다 */
  resolved: boolean
  displayName: string | null
  couple: CoupleSummary | null
  members: CoupleMember[]
  loadFailed: boolean
}

const EMPTY_COUPLE: CoupleState = {
  ownerId: null, sharedCouple: null, spaces: [],
  resolved: true,
  displayName: null,
  couple: null,
  members: [],
  loadFailed: false,
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    status: 'loading',
    userId: null,
    email: null,
  })
  const [coupleState, setCoupleState] = useState<CoupleState>({
    ...EMPTY_COUPLE,
    resolved: false,
  })

  // 커플 조회는 reload()로도 트리거되므로 응답이 뒤섞일 수 있다.
  // 늦게 도착한 낡은 응답이 최신 상태를 덮어쓰지 않도록 세대 번호로 거른다.
  const loadGeneration = useRef(0)
  const preferredSpace = useRef<string | null>(null)
  const authOwner = useRef<string | null>(null)

  useEffect(() => {
    let alive = true

    const apply = (userId: string | null, email: string | null) => {
      if (!alive) return
      if (authOwner.current !== userId) {
        authOwner.current = userId
        loadGeneration.current++
        preferredSpace.current = null
        setRecordScope(null)
        scopeToCouple(null)
        setCoupleState({ ...EMPTY_COUPLE, resolved: false })
      }
      setAuth({ status: userId === null ? 'signed-out' : 'signed-in', userId, email })
    }

    void supabase.auth.getSession().then(({ data }) => {
      apply(data.session?.user.id ?? null, data.session?.user.email ?? null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // auth-js는 이 콜백을 내부 락을 쥔 채 호출한다. 여기서 supabase를 다시 호출하면
      // 데드락이 날 수 있으므로 상태만 바꾸고, 실제 데이터 로드는 userId를 의존성으로 하는
      // 아래 effect에 맡긴다.
      apply(session?.user.id ?? null, session?.user.email ?? null)
    })

    return () => {
      alive = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  // 사용자가 바뀌면(로그인/로그아웃) 이전 사용자의 커플 정보로 라우팅 판단을 하지 않도록
  // 즉시 무효화한다. load() 시작 시점마다 내리지 않는 이유: 커플 생성 직후의 reload()에서도
  // 화면 전체가 스피너로 바뀌었다가 돌아오는 깜빡임이 생기기 때문이다.
  useEffect(() => {
    setCoupleState((prev) => (prev.resolved ? { ...prev, resolved: false } : prev))
  }, [auth.userId])

  // 컨텍스트 값으로 내보내고 effect 의존성으로도 쓰므로 참조가 안정적이어야 한다.
  const load = useCallback(async () => {
    const generation = (loadGeneration.current += 1)
    const userId = auth.userId
    if (userId === null) {
      setCoupleState(EMPTY_COUPLE)
      return
    }

    const context = await supabase.rpc('get_record_context', {})
    if (generation !== loadGeneration.current) return
    const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    if (context.error || !context.data || !validId(context.data.personal_id) || (context.data.shared_id !== null && !validId(context.data.shared_id))) {
      setCoupleState({ ...EMPTY_COUPLE, ownerId: userId, loadFailed: true })
      return
    }
    const { personal_id: personalId, shared_id: sharedId } = context.data
    if (preferredSpace.current === null) {
      try { preferredSpace.current = sessionStorage.getItem('dbj.scope.' + userId) } catch { /* 저장소 차단은 개인 공간 사용을 막지 않는다. */ }
    }
    const selectedId = sharedId !== null && preferredSpace.current === sharedId ? sharedId : personalId
    const personal = selectedId === personalId
    setRecordScope(selectedId)

    // 왕복 2회(직렬)로 끝낸다. 멤버십을 먼저 알아야 프로필을 누구까지 읽을지 정해지기 때문이다.
    // RLS가 `couple_id = current_couple_id()`로 걸러 주지만, 클라이언트에서도 조건을 빠뜨리지
    // 않는 것이 원칙이다 (00 §1). 여기서는 필터 자체가 "내 커플"이라 추가 조건이 없다.
    const membership = await supabase
      .from('couple_members')
      .select('couple_id, user_id, role')
    if (generation !== loadGeneration.current) return
    if (membership.error) {
      setCoupleState({ ...EMPTY_COUPLE, ownerId: userId, resolved: true, loadFailed: true })
      return
    }

    const rows = membership.data ?? []
    const coupleId = sharedId
    const userIds = rows.length > 0 ? rows.map((row) => row.user_id) : [userId]

    const [coupleRes, profileRes] = await Promise.all([
      coupleId === null
        ? null
        : supabase
            .from('couples')
            .select('id, started_on, status')
            .eq('id', coupleId)
            .maybeSingle(),
      supabase.from('profiles').select('id, display_name').in('id', userIds),
    ])
    if (generation !== loadGeneration.current) return

    if (profileRes.error || coupleRes?.error) {
      setCoupleState({ ...EMPTY_COUPLE, ownerId: userId, resolved: true, loadFailed: true })
      return
    }

    const nameByUserId = new Map(
      (profileRes.data ?? []).map((row) => [row.id, row.display_name]),
    )
    const couple = coupleRes?.data ?? null

    const sharedCouple: CoupleSummary | null = couple === null ? null : { id: couple.id, startedOn: couple.started_on, status: couple.status, kind: 'shared' }
    const spaces: NonNullable<SessionValue['spaces']> = [{ id: personalId, label: '내 기록', kind: 'personal' }]
    if (sharedCouple !== null) spaces.push({ id: sharedCouple.id, label: '기존 공동 기록', kind: 'shared' })
    setCoupleState({
      ownerId: userId, sharedCouple, spaces,
      resolved: true,
      displayName: nameByUserId.get(userId) ?? null,
      couple:
        personal ? { id: personalId, startedOn: todayKst(), status: 'active', kind: 'personal' } : sharedCouple,
      // owner를 먼저 두어 화면 어디서든 순서가 일정하게 한다 (리스트 key 안정성).
      members: (personal ? [{ user_id: userId, role: 'owner' as const, couple_id: personalId }] : rows)
        .map((row) => ({
          userId: row.user_id,
          role: row.role,
          displayName: nameByUserId.get(row.user_id) ?? '',
        }))
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1)),
      loadFailed: false,
    })
  }, [auth.userId])

  useEffect(() => {
    if (auth.status === 'loading') return
    void load()
  }, [auth.status, load])

  // AC-14/AC-15: 커플이 바뀌면(로그아웃, 다른 계정 로그인, 연결 해제 후 재결합) 화면 밖
  // 모듈 캐시가 이전 커플 데이터를 그대로 들고 있다. 각 화면도 읽기 전에 같은 검사를 하지만,
  // 캐시를 읽는 화면이 마운트되지 않은 경로(해제 → 온보딩 등)에서도 확실히 비우도록 여기서
  // 한 번 더 건다.
  useEffect(() => {
    scopeToCouple(coupleState.couple?.id ?? null, auth.userId)
  }, [coupleState.couple?.id, auth.userId])

  useRevalidation(load)
  const selectSpace = useCallback(async (id: string) => {
    if (!coupleState.spaces.some(space => space.id === id)) return
    preferredSpace.current = id
    try { sessionStorage.setItem('dbj.scope.' + auth.userId, id) } catch { /* 메모리 선택은 유지한다. */ }
    setCoupleState(prev => ({ ...prev, resolved: false }))
    scopeToCouple(null)
    await load()
  }, [auth.userId, coupleState.spaces, load])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    // F-25 / AC-15: 세션 종료만으로는 앱이 캐시한 값이 남는다. 접두사 단위로 전부 지운다.
    setRecordScope(null)
    clearAppStorage()
    // 저장소뿐 아니라 메모리(모듈 스코프) 캐시도 지운다 — 로그아웃은 페이지를 리로드하지
    // 않으므로 모듈 변수는 그대로 살아 있다.
    scopeToCouple(null)
    setCoupleState(EMPTY_COUPLE)
  }, [])

  const value = useMemo<SessionValue>(() => {
    const partner =
      coupleState.members.find((member) => member.userId !== auth.userId) ?? null
    return {
      // 커플 조회가 끝나기 전에 'signed-in'을 노출하면 가드가 "커플 없음"으로 오판해
      // 온보딩으로 튕긴다. 커플 상태까지 확정된 뒤에 signed-in을 내보낸다.
      status:
        auth.status === 'signed-in' && (!coupleState.resolved || coupleState.ownerId !== auth.userId) ? 'loading' : auth.status,
      userId: auth.userId,
      email: auth.email,
      displayName: coupleState.displayName,
      couple: coupleState.couple,
      members: coupleState.members,
      partner,
      sharedCouple: coupleState.sharedCouple,
      spaces: coupleState.spaces,
      selectSpace,
      loadFailed: coupleState.loadFailed,
      reload: load,
      signOut,
    }
    // 컨텍스트 값이라 매 렌더 새 객체를 만들면 하위 트리 전체가 리렌더된다.
  }, [auth, coupleState, load, signOut, selectSpace])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
