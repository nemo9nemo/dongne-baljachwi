import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { createCouple, failureMessage, redeemInvite } from '../../lib/couple-rpc'
import type { RpcFailure } from '../../lib/couple-rpc'
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '../../lib/invite-code'
import ui from '../../styles/ui.module.css'

/** F-06: `display_name` 길이 제한 (00 §4.1) */
const NAME_MIN = 1
const NAME_MAX = 12

type Step = 'name' | 'choice' | 'create' | 'join'

/**
 * 온보딩 (01 §2.1 4~6, §2.2 1~3).
 *
 * 이름 → 만들기/합류 선택 → (시작일 입력 | 코드 입력) 세 단계를 한 컴포넌트에 둔다.
 * 단계마다 파일을 쪼개면 공유해야 할 상태(이름, 진행 중 여부, 에러)를 위로 끌어올려야 해서
 * 오히려 흩어진다. 응집도가 높으므로 한 파일에 유지한다.
 *
 * 이 화면은 `RequireNoCouple` 뒤에서만 렌더된다 — 이미 커플이면 화면 자체가 뜨지 않는다
 * (01 §2.4).
 */
export function OnboardingScreen() {
  const session = useSession()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('name')
  // 트리거가 넣어 둔 이메일 로컬파트를 초기값으로 보여준다 (F-05).
  const [name, setName] = useState(() => session.displayName ?? '')
  const [startedOn, setStartedOn] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<RpcFailure | null>(null)
  const [retryAfterSec, setRetryAfterSec] = useState(0)

  // 로컬(KST) 기준 오늘. `toISOString()`은 UTC라 자정 전후로 하루가 어긋난다.
  // 'sv-SE' 로케일의 날짜 표기가 ISO(YYYY-MM-DD)와 같아 변환 없이 그대로 쓸 수 있다. (00 D-13)
  const [today] = useState(() => new Date().toLocaleDateString('sv-SE'))

  // F-12: rate limit 남은 시간 카운트다운. 0이 되면 다시 시도할 수 있다.
  const counting = retryAfterSec > 0
  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => {
      setRetryAfterSec((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [counting])

  const trimmedName = name.trim()
  const nameValid = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX
  const normalizedCode = normalizeInviteCode(codeInput)

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (startedOn.length === 0 || pending) return

    setPending(true)
    setFailure(null)
    const result = await createCouple(startedOn, trimmedName)
    if (!result.ok) {
      setFailure(result.failure)
      setPending(false)
      return
    }

    // 순서가 중요하다. reload()를 먼저 기다리면, 커플이 생겼다는 사실을 가드가 먼저 알아채
    // 이 화면(RequireNoCouple 뒤)이 /lines 로 튕긴 다음에 navigate가 실행된다.
    // 먼저 이동해 이 화면을 가드 밖으로 빼고, 세션 갱신은 뒤따르게 한다.
    //
    // 01 §2.1-7: 생성 직후 할 일은 초대 코드를 보여주는 것이다. create_couple이 코드를
    // 이미 돌려주므로 다음 화면에 넘겨 준다 — 방금 받은 값을 다시 조회할 이유가 없다.
    navigate('/invite', {
      replace: true,
      state: {
        origin: 'create',
        code: result.data.code,
        expiresAt: result.data.expires_at,
      },
    })
    void session.reload()
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (normalizedCode.length !== INVITE_CODE_LENGTH || pending || counting) return

    setPending(true)
    setFailure(null)
    const result = await redeemInvite(normalizedCode, trimmedName)
    if (!result.ok) {
      setFailure(result.failure)
      if (result.failure.code === 'RATE_LIMITED') {
        setRetryAfterSec(result.failure.retryAfterSec ?? 0)
      }
      setPending(false)
      return
    }

    // 생성 흐름과 같은 이유로 이동이 먼저다 (가드가 이 화면을 먼저 걷어내지 않도록).
    navigate('/couple/linked', {
      replace: true,
      state: { partnerName: result.data.partner_display_name },
    })
    void session.reload()
  }

  const errorText =
    failure === null
      ? null
      : failure.code === 'RATE_LIMITED' && retryAfterSec > 0
        ? `${failureMessage(failure)} ${Math.floor(retryAfterSec / 60)}분 ${retryAfterSec % 60}초 후에 다시 시도해주세요.`
        : failureMessage(failure)

  if (step === 'name') {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <h1 className={ui.title}>어떻게 불러드릴까요?</h1>
          <p className={ui.subtitle}>기록에 작성자로 표시되는 이름이에요.</p>
        </header>
        <form
          className={ui.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (nameValid) setStep('choice')
          }}
        >
          <div className={ui.field}>
            <label className={ui.label} htmlFor="onboarding-name">
              내 이름
            </label>
            <input
              id="onboarding-name"
              className={ui.input}
              type="text"
              value={name}
              maxLength={NAME_MAX}
              autoComplete="nickname"
              aria-describedby="onboarding-name-hint"
              onChange={(event) => setName(event.target.value)}
            />
            <p id="onboarding-name-hint" className={ui.hint}>
              {NAME_MIN}~{NAME_MAX}자
            </p>
          </div>
          <button
            type="submit"
            className={`${ui.button} ${ui.buttonPrimary}`}
            disabled={!nameValid}
          >
            다음
          </button>
        </form>
      </div>
    )
  }

  if (step === 'choice') {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <h1 className={ui.title}>{trimmedName}님, 반가워요</h1>
          <p className={ui.subtitle}>둘 중 하나를 고르면 돼요.</p>
        </header>
        <div className={ui.form}>
          <button
            type="button"
            className={`${ui.button} ${ui.buttonPrimary}`}
            onClick={() => {
              setFailure(null)
              setStep('create')
            }}
          >
            우리 커플 만들기
          </button>
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              setFailure(null)
              setStep('join')
            }}
          >
            초대 코드 입력하기
          </button>
        </div>
        <p className={ui.linkRow}>
          <button type="button" className={ui.button} onClick={() => setStep('name')}>
            이름 다시 입력
          </button>
        </p>
      </div>
    )
  }

  if (step === 'create') {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <h1 className={ui.title}>언제부터 만났나요?</h1>
          <p className={ui.subtitle}>디데이를 세는 기준이 돼요.</p>
        </header>

        {errorText !== null && (
          <p className={ui.errorBanner} role="alert">
            {errorText}
          </p>
        )}

        <form className={ui.form} onSubmit={handleCreate} noValidate>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="onboarding-started-on">
              사귀기 시작한 날
            </label>
            <input
              id="onboarding-started-on"
              className={ui.input}
              type="date"
              value={startedOn}
              // F-07: 미래 날짜 금지. 브라우저 제약은 편의일 뿐이고 서버도 검증한다.
              max={today}
              disabled={pending}
              onChange={(event) => setStartedOn(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className={`${ui.button} ${ui.buttonPrimary}`}
            disabled={startedOn.length === 0 || pending}
          >
            {pending ? '만드는 중…' : '커플 만들기'}
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={pending}
            onClick={() => setStep('choice')}
          >
            뒤로
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <h1 className={ui.title}>초대 코드 입력</h1>
        <p className={ui.subtitle}>상대가 보내준 8자리 코드를 넣어주세요.</p>
      </header>

      <form className={ui.form} onSubmit={handleJoin} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="onboarding-code">
            초대 코드
          </label>
          <input
            id="onboarding-code"
            className={`${ui.input} ${ui.codeInput}`}
            type="text"
            value={codeInput}
            // 브라우저 자동완성/자동수정이 코드 문자를 건드리면 안 된다 (01 §6).
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            // 정규화가 문자를 걸러내므로 원문은 넉넉히 받는다 (하이픈·공백 포함 입력 허용).
            maxLength={20}
            disabled={pending}
            aria-label="초대 코드 8자리"
            aria-describedby="onboarding-code-status"
            aria-invalid={failure !== null}
            onChange={(event) => setCodeInput(event.target.value)}
          />
          {/* 스크린리더가 한 글자씩 읽도록 공백으로 띄워 읽어 준다 (01 §6). */}
          <p id="onboarding-code-status" className={ui.hint} aria-live="polite">
            {normalizedCode.length === 0
              ? '대소문자와 하이픈은 신경 쓰지 않아도 돼요.'
              : `입력한 코드 ${normalizedCode.split('').join(' ')} (${normalizedCode.length}/${INVITE_CODE_LENGTH})`}
          </p>
          {errorText !== null && (
            <p className={ui.error} role="alert" aria-live="assertive">
              {errorText}
            </p>
          )}
        </div>

        <button
          type="submit"
          className={`${ui.button} ${ui.buttonPrimary}`}
          disabled={normalizedCode.length !== INVITE_CODE_LENGTH || pending || counting}
        >
          {pending ? '확인하는 중…' : '연결하기'}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={pending}
          onClick={() => setStep('choice')}
        >
          뒤로
        </button>
      </form>
    </div>
  )
}
