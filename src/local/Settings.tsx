import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { todayKst } from '../lib/format-date'
import { newMap, type LocalMap, type LocalState } from './model'
import { getState, mutate, requestPersistence } from './storage'
import { createBackup, restoreBackup } from './backup'
import { createShare, DeviceShare, disconnectShare, joinShare, type ShareStatus } from './sharing'
import { Modal } from './components'
import { localTime } from './ui-utils'
import { exportBackup, isNativeDevice } from './platform'

type Props = {
  state: LocalState
  map: LocalMap
  status?: ShareStatus
  connection?: DeviceShare
  busy: boolean
  error: string
  perform: (action: () => Promise<void>, success?: string) => Promise<void>
}
export function Settings({ state, map, status, connection, busy, error, perform }: Props) {
  const [server, setServer] = useState(import.meta.env.VITE_SHARE_SERVER ?? ''),
    [code, setCode] = useState(''),
    [title, setTitle] = useState(''),
    [name, setName] = useState(state.name)
  const [password, setPassword] = useState(''),
    [restoreFile, setRestoreFile] = useState<File | null>(null),
    [persisted, setPersisted] = useState<boolean | null>(null),
    [backupDialog, setBackupDialog] = useState(false)
  const [rename, setRename] = useState(map.title),
    [backupScope, setBackupScope] = useState('all'),
    [backupStart, setBackupStart] = useState(''),
    [backupEnd, setBackupEnd] = useState('')
  useEffect(() => setRename(map.title), [map.id, map.title])
  useEffect(() => {
    if (isNativeDevice) setPersisted(true)
    else
      void navigator.storage
        ?.persisted?.()
        .then(setPersisted)
        .catch(() => {})
  }, [])
  const storageBytes = map.records.reduce(
    (total, record) => total + record.photos.reduce((sum, photo) => sum + photo.bytes, 0),
    0
  )
  return (
    <div className="local-settings">
      <section className="local-settings-card">
        <h2>내 맵</h2>
        <p>새 맵을 만들면 기록을 따로 모을 수 있어요.</p>
        <form
          className="local-form"
          onSubmit={(event) => {
            event.preventDefault()
            void perform(() =>
              mutate((state) => {
                if (state.maps.length >= 30) throw new Error('맵은 최대 30개까지 만들 수 있어요.')
                const map = newMap(title.trim() || '새 발자취')
                state.maps.push(map)
                state.selectedMapId = map.id
              }).then(() => setTitle(''))
            )
          }}
        >
          <label>
            새 맵 이름
            <input
              maxLength={60}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            개인 맵 만들기
          </Button>
        </form>
        <form
          className="local-form"
          onSubmit={(event) => {
            event.preventDefault()
            void perform(
              () =>
                mutate((state) => {
                  state.name = name.trim() || '나'
                }).then(() => {}),
              '앞으로 남기는 기록의 작성자 이름에 반영해요.'
            )
          }}
        >
          <label>
            내 이름
            <input maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>
            이름 저장
          </Button>
        </form>
        <form
          className="local-form"
          onSubmit={(event) => {
            event.preventDefault()
            void perform(() =>
              mutate((state) => {
                const target = state.maps.find((item) => item.id === map.id)
                if (!target || target.share?.role === 'guest')
                  throw new Error('받은 공유 맵은 연결을 끊은 뒤 수정할 수 있어요.')
                target.title = rename.trim() || '내 발자취'
                target.revision++
              }).then(() => {})
            )
          }}
        >
          <label>
            현재 맵 이름
            <input
              maxLength={60}
              value={rename}
              onChange={(event) => setRename(event.target.value)}
              disabled={map.share?.role === 'guest'}
            />
          </label>
          <Button type="submit" disabled={busy || map.share?.role === 'guest'}>
            맵 이름 변경
          </Button>
        </form>
        {!map.share && (
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (
                confirm('이 맵의 기록과 사진을 삭제할까요? 백업하지 않은 기록은 복구할 수 없어요.')
              )
                void perform(
                  () =>
                    mutate((state) => {
                      const target = state.maps.find((item) => item.id === map.id)
                      if (target?.share) throw new Error('공유 연결을 먼저 끊어주세요.')
                      state.maps = state.maps.filter((item) => item.id !== map.id)
                      if (!state.maps.length) state.maps.push(newMap())
                      state.selectedMapId = state.maps[0]!.id
                    }).then(() => {}),
                  '맵을 삭제했어요.'
                )
            }}
          >
            현재 개인 맵 삭제
          </Button>
        )}
      </section>
      <section className="local-settings-card">
        <h2>코드로 맵 공유</h2>
        <p>
          이 맵의 기록과 사진을 승인한 상대 기기에 복사해요. 두 앱을 열어두면 변경을 동기화해요.
        </p>
        <label className="local-field">
          연결 서버 <span className="local-muted">현재 서버를 사용하면 비워두세요.</span>
          <input
            aria-label="공유 연결 서버"
            placeholder="https://share.example.com"
            value={server}
            onChange={(event) => setServer(event.target.value)}
            disabled={Boolean(map.share)}
          />
        </label>
        {!map.share ? (
          <div className="local-form">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void perform(() => createShare(map.id, server))}
            >
              이 맵의 공유 코드 만들기
            </Button>
            <form
              className="local-form"
              onSubmit={(event) => {
                event.preventDefault()
                void perform(() => joinShare(code, server))
              }}
            >
              <label>
                초대받은 공유 코드
                <input
                  value={code}
                  autoCapitalize="characters"
                  maxLength={16}
                  placeholder="AAAA-BBBB-CCCC"
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || !code.trim()}>
                코드로 연결 요청
              </Button>
            </form>
          </div>
        ) : (
          <div className="local-form">
            {map.share.role === 'host' && (
              <>
                <span className="local-muted">연결 코드</span>
                <output aria-label="공유 코드" className="local-code">
                  {map.share.code.match(/.{1,4}/g)?.join('-')}
                </output>
              </>
            )}
            <p role="status">{status?.message ?? '연결 준비 중…'}</p>
            {status?.phrase && (
              <p>
                두 화면의 확인 문자 <strong data-testid="pair-phrase">{status.phrase}</strong>
              </p>
            )}
            {status?.stage === 'approval' && (
              <Button
                type="button"
                variant="default"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await connection?.approve()
                  })
                }
              >
                이 기기 연결 허용
              </Button>
            )}
            <p className="local-muted">마지막 동기화: {localTime(map.share.lastSync)}</p>
            <Button type="button" disabled={busy} onClick={() => connection?.retry()}>
              연결 다시 시도
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    '연결을 끊으면 이 기기에 받은 기록과 사진은 개인 맵으로 남아요. 아직 받지 못한 기록과 사진은 포함되지 않아요. 계속할까요?'
                  )
                )
                  void perform(
                    () => disconnectShare(map.id),
                    '연결을 끊었어요. 이제 이 맵을 개인 맵으로 수정할 수 있어요.'
                  )
              }}
            >
              연결 끊고 개인 맵으로
            </Button>
          </div>
        )}
        {state.revocations.length > 0 && (
          <p className="local-muted">
            이 기기에서는 연결이 해제됐어요. 상대에게 해제 사실을 전달하려면 연결 서버에 다시
            접속해야 해요.
          </p>
        )}
      </section>
      <section className="local-settings-card">
        <h2>백업·복원</h2>
        <p>
          이 기기를 잃거나 브라우저 데이터를 지우기 전에 사진까지 포함한 백업을 기기 밖에
          보관해주세요.
        </p>
        <p className="local-muted">
          이 맵 사진 약 {(storageBytes / 1024 / 1024).toFixed(1)}MB · 마지막 파일 생성{' '}
          {localTime(state.lastBackup)}
        </p>
        <Button
          type="button"
          onClick={() => {
            setPassword('')
            setRestoreFile(null)
            setBackupDialog(true)
          }}
        >
          암호화 백업·복원 열기
        </Button>
      </section>
      <section className="local-settings-card">
        <h2>기기 저장 안내</h2>
        <p>
          {isNativeDevice
            ? '기록은 앱 내부 SQLite에, 사진은 앱 전용 파일에 보관해요. 앱 삭제·기기 분실 시 없어질 수 있어요.'
            : '기록과 사진은 이 브라우저의 저장소에 보관해요. 브라우저 데이터 삭제·앱 삭제·기기 분실 시 없어질 수 있어요.'}{' '}
          백업 파일로 다른 기기에 복원할 수 있어요.
        </p>
        <p className="local-muted">
          영구 저장 허용:{' '}
          {persisted === null ? '확인 중' : persisted ? '허용됨' : '아직 허용되지 않음'}
        </p>
        <Button
          type="button"
          onClick={() =>
            void perform(async () => {
              setPersisted(await requestPersistence())
            })
          }
        >
          기기 저장 보호 요청
        </Button>
        <p className="local-muted">
          허용되어도 사용자가 저장 데이터를 지우면 삭제돼요. 공유는 승인한 맵만 전송해요. 광고 SDK는
          아직 연결되지 않았어요.
        </p>
      </section>
      {backupDialog && (
        <Modal
          title="암호화 백업·복원"
          onClose={() => {
            if (!busy) {
              setBackupDialog(false)
              setPassword('')
            }
          }}
        >
          <div className="local-form">
            <p>
              암호는 파일을 복원할 때 필요해요. 암호를 잊으면 복원할 수 없으니 안전하게
              보관해주세요. 연결 권한은 백업에 포함되지 않으며 복원한 맵은 독립 개인 맵이 돼요.
            </p>
            <label>
              백업 암호
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              백업 범위
              <select value={backupScope} onChange={(event) => setBackupScope(event.target.value)}>
                <option value="all">전체 맵</option>
                <option value="current">현재 맵</option>
              </select>
            </label>
            <div className="local-filters">
              <label>
                백업 시작일
                <input
                  type="date"
                  value={backupStart}
                  onChange={(event) => setBackupStart(event.target.value)}
                />
              </label>
              <label>
                백업 종료일
                <input
                  type="date"
                  value={backupEnd}
                  onChange={(event) => setBackupEnd(event.target.value)}
                />
              </label>
            </div>
            <p className="local-muted">
              파일 하나에 사진 합계 256MB까지 담을 수 있어요. 기록이 많으면 맵·기간을 나눠
              백업해주세요. 날짜를 비워두면 전체 기간을 담아요.
            </p>
            <Button
              type="button"
              variant="default"
              disabled={busy || password.length < 8}
              onClick={() =>
                void perform(async () => {
                  if (backupStart && backupEnd && backupStart > backupEnd)
                    throw new Error('백업 시작일이 종료일보다 늦어요.')
                  const snapshot = structuredClone(getState())
                  snapshot.maps = snapshot.maps
                    .filter((item) => backupScope === 'all' || item.id === map.id)
                    .map((item) => ({
                      ...item,
                      records: item.records.filter(
                        (record) =>
                          (!backupStart || record.date >= backupStart) &&
                          (!backupEnd || record.date <= backupEnd)
                      )
                    }))
                  const blob = await createBackup(snapshot, password)
                  await exportBackup(blob, `동네발자취-${todayKst()}.baljachwi`)
                  await mutate((state) => {
                    state.lastBackup = new Date().toISOString()
                    state.backupVersion =
                      backupScope === 'all' && !backupStart && !backupEnd ? snapshot.version : null
                  })
                  setBackupDialog(false)
                  setPassword('')
                }, '암호화 백업 파일을 만들었어요. 다운로드된 파일을 기기 밖의 안전한 곳에 보관해주세요.')
              }
            >
              전체 맵·사진 백업 파일 만들기
            </Button>
            <hr />
            <label>
              복원할 백업 파일
              <input
                aria-label="복원할 백업 파일"
                type="file"
                accept=".baljachwi"
                onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <p className="local-muted">기존 맵을 덮어쓰지 않고 새 개인 맵으로 추가해요.</p>
            <Button
              type="button"
              disabled={busy || password.length < 8 || !restoreFile}
              onClick={() =>
                void perform(async () => {
                  await restoreBackup(restoreFile!, password)
                  setBackupDialog(false)
                  setPassword('')
                  setRestoreFile(null)
                }, '백업의 기록과 사진을 새 개인 맵으로 복원했어요.')
              }
            >
              백업에서 복원
            </Button>
            {busy && <p role="status">사진과 백업을 처리하고 있어요. 잠시만 기다려주세요.</p>}
            {error && (
              <p role="alert" className="local-error">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
