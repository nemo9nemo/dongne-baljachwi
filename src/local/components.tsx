import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../components/ui/button'
import {
  preparePhoto,
  prepareThumbnail,
  rejectionMessage,
  rejectionOf
} from '../lib/image-preparation'
import { todayKst } from '../lib/format-date'
import { searchStations, stationByCode } from './catalog'
import {
  digest,
  isReadOnly,
  validateRecord,
  type LocalMap,
  type LocalPhoto,
  type LocalRecord,
  type StoredPhoto
} from './model'
import { getPhoto, getState, mutate } from './storage'
import { errorMessage } from './ui-utils'

export function Photo({
  id,
  blob,
  alt,
  onClick,
  thumbnail = false
}: {
  id?: string
  blob?: Blob
  alt: string
  onClick?: () => void
  thumbnail?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true,
      owned: string | undefined
    void (blob ? Promise.resolve(blob) : id ? getPhoto(id, thumbnail) : Promise.resolve(null))
      .then((value) => {
        if (!alive || !value) return
        owned = URL.createObjectURL(value)
        setUrl(owned)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (owned) URL.revokeObjectURL(owned)
    }
  }, [id, blob, thumbnail])
  const content = url ? (
    <img src={url} alt={alt} loading="lazy" />
  ) : (
    <span className="local-photo-missing">사진을 읽을 수 없어요</span>
  )
  return onClick ? (
    <button type="button" className="local-photo" onClick={onClick} aria-label={alt + ' 크게 보기'}>
      {content}
    </button>
  ) : (
    <div className="local-photo">{content}</div>
  )
}
export function Modal({
  title,
  children,
  onClose
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="local-overlay" />
        <Dialog.Content className="local-dialog" aria-describedby={undefined}>
          <div className="local-dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <button type="button" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function RecordForm({
  map,
  record,
  station,
  onClose,
  onSaved
}: {
  map: LocalMap
  record: LocalRecord | null
  station: string
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [stationCode, setStation] = useState(record?.stationCode ?? station),
    [search, setSearch] = useState('')
  const [date, setDate] = useState(record?.date ?? todayKst()),
    [place, setPlace] = useState(record?.place ?? ''),
    [note, setNote] = useState(record?.note ?? '')
  const [tags, setTags] = useState(record?.tags.join(', ') ?? ''),
    [mood, setMood] = useState(record?.mood ?? ''),
    [weather, setWeather] = useState(record?.weather ?? '')
  const [photos, setPhotos] = useState<LocalPhoto[]>(record?.photos ?? []),
    [prepared, setPrepared] = useState<StoredPhoto[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const close = () => {
    if (!busy && (!dirty || confirm('작성 중인 내용을 닫을까요? 저장하지 않은 변경은 사라져요.')))
      onClose()
  }
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    addEventListener('beforeunload', leave)
    return () => removeEventListener('beforeunload', leave)
  }, [dirty])
  async function addPhotos(files: FileList | null) {
    if (!files || busy) return
    setBusy(true)
    setError('')
    try {
      if (files.length + photos.length > 10)
        throw new Error('사진은 기록마다 최대 10장까지 추가할 수 있어요.')
      const additions: LocalPhoto[] = [],
        blobs: StoredPhoto[] = []
      for (const file of files) {
        const rejection = rejectionOf(file)
        if (rejection) throw new Error(rejectionMessage(rejection, file.name))
        const photo = await preparePhoto(file),
          id = crypto.randomUUID()
        additions.push({
          id,
          bytes: photo.byteSize,
          width: photo.width,
          height: photo.height,
          type: 'image/jpeg',
          hash: await digest(photo.blob)
        })
        blobs.push({ id, blob: photo.blob, thumbnail: await prepareThumbnail(photo.blob) })
      }
      setPhotos((previous) => [...previous, ...additions])
      setPrepared((previous) => [...previous, ...blobs])
      setDirty(true)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const now = new Date().toISOString(),
        id = record?.id ?? crypto.randomUUID()
      const next = validateRecord({
        id,
        stationCode,
        date,
        place,
        note,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        mood,
        weather,
        photos,
        revision: (record?.revision ?? -1) + 1,
        createdAt: record?.createdAt ?? now,
        updatedAt: now,
        author: record?.author ?? getState().name,
        ...(record?.originId ? { originId: record.originId } : {})
      })
      await mutate((state) => {
        const target = state.maps.find((item) => item.id === map.id)
        if (!target || isReadOnly(target)) throw new Error('현재 맵에는 기록을 수정할 수 없어요.')
        const existing = target.records.find((item) => item.id === id)
        if (record && (!existing || existing.revision !== record.revision))
          throw new Error('다른 화면에서 기록이 바뀌었어요. 닫은 뒤 최신 기록을 다시 열어주세요.')
        target.records = existing
          ? target.records.map((item) => (item.id === id ? next : item))
          : [...target.records, next]
        target.revision++
      }, prepared)
      setDirty(false)
      onSaved(id)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={record ? '기록 수정' : '발자취 남기기'} onClose={close}>
      <form
        className="local-form"
        onSubmit={(event) => void save(event)}
        onChange={() => setDirty(true)}
      >
        <div className="local-field">
          <span>역</span>
          <strong>{stationByCode.get(stationCode)?.name ?? '역을 선택해주세요'}</strong>
          <label>
            다른 역 찾기
            <input
              aria-label="기록할 역 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={busy}
            />
          </label>
          {search && (
            <ul className="local-results">
              {searchStations(search).map((station) => (
                <li key={station.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setStation(station.code)
                      setSearch('')
                      setDirty(true)
                    }}
                  >
                    {station.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label>
          방문 날짜
          <input
            type="date"
            required
            value={date}
            max={todayKst()}
            onChange={(event) => setDate(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          장소 이름 <span className="local-muted">선택</span>
          <input
            maxLength={80}
            value={place}
            placeholder="카페, 공원, 동네 이름"
            onChange={(event) => setPlace(event.target.value)}
            disabled={busy}
          />
        </label>
        <div className="local-field">
          <span>
            사진 <span className="local-muted">{photos.length}/10</span>
          </span>
          <div className="local-photo-grid">
            {photos.map((photo, index) => (
              <div key={photo.id}>
                <Photo
                  id={photo.id}
                  blob={prepared.find((item) => item.id === photo.id)?.blob}
                  alt={`첨부 사진 ${index + 1}`}
                />
                <button
                  type="button"
                  className="local-text-button"
                  disabled={busy}
                  onClick={() => {
                    setPhotos((previous) => previous.filter((item) => item.id !== photo.id))
                    setDirty(true)
                  }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <input
            ref={input}
            aria-label="사진 파일 선택"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => void addPhotos(event.target.files)}
            disabled={busy}
          />
          <small>기기에 복사해 보관해요. JPG·PNG·WebP, 원본 10MB 이하.</small>
        </div>
        <label>
          기억할 이야기 <span className="local-muted">선택</span>
          <textarea
            rows={5}
            maxLength={1000}
            value={note}
            placeholder="오늘의 한 장면을 남겨보세요."
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
        </label>
        <details>
          <summary>태그·감정·날씨</summary>
          <div className="local-form">
            <label>
              태그
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="쉼표로 구분"
                disabled={busy}
              />
            </label>
            <label>
              감정
              <select
                value={mood}
                onChange={(event) => setMood(event.target.value)}
                disabled={busy}
              >
                {['', '😊', '🙂', '😐', '😔', '🥰'].map((item) => (
                  <option key={item} value={item}>
                    {item || '선택 안 함'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              날씨
              <select
                value={weather}
                onChange={(event) => setWeather(event.target.value)}
                disabled={busy}
              >
                {['', '☀️', '⛅', '☁️', '🌧️', '❄️'].map((item) => (
                  <option key={item} value={item}>
                    {item || '선택 안 함'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {error && (
          <p role="alert" className="local-error">
            {error}
          </p>
        )}
        <Button type="submit" variant="default" disabled={busy || !stationCode}>
          {busy ? '사진 준비·저장 중…' : '기기에 저장'}
        </Button>
      </form>
    </Modal>
  )
}
