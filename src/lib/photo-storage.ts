import { supabase } from './supabase'
import type { PreparedPhoto } from '../screens/records/photo-pipeline'

/**
 * `record-photos` 버킷에 대한 순수 Storage 접근 (00 §4.6, 05 §4.3).
 *
 * 원래 `screens/records/photo-pipeline.ts` 안에 있었는데, 타임라인(08)의 카드 썸네일도
 * 서명 URL 발급이 필요해져 두 번째 사용처가 생겨서 꺼냈다. 리사이즈·EXIF 처리 같은
 * "사진 입력 파이프라인"은 여전히 `photo-pipeline.ts` 소관이다 — 여기는 이미 만들어진
 * 객체를 올리고/지우고/서명 URL을 받는 것만 한다.
 */

const BUCKET = 'record-photos'

/** F-21 / 00 §4.6: 첫 세그먼트가 Storage RLS의 격리 축이다 */
export function photoStoragePath(coupleId: string, recordId: string, photoId: string): string {
  return `${coupleId}/${recordId}/${photoId}.jpg`
}

/**
 * Storage 업로드 1건. 성공 여부만 돌려준다 — 실패 사유별로 다르게 안내할 화면이 없고,
 * 대응은 "재시도" 하나뿐이다 (F-17).
 *
 * `upsert: true`인 이유: 같은 photo_id로 재시도할 때 이전 시도의 잔해가 남아 있으면
 * 409로 영원히 실패한다. 경로에 uuid가 들어가 있어 남의 파일을 덮을 위험은 없다.
 */
export async function uploadPhoto(path: string, photo: PreparedPhoto): Promise<boolean> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, photo.blob, { contentType: photo.contentType, upsert: true })
  return error === null
}

/** 수정 시 삭제된 사진의 Storage 객체 정리 (05 §4.3). 실패해도 배치가 고아 객체를 치운다 */
export async function removePhotoObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await supabase.storage.from(BUCKET).remove(paths)
}

/** 원본 크기 서명 URL (00 §4.6: 공개 URL을 쓰지 않는다). 상세·뷰어·편집기가 쓴다 */
export async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error !== null || data === null) return signed
  for (const item of data) {
    if (item.signedUrl !== null && item.path !== null) signed.set(item.path, item.signedUrl)
  }
  return signed
}

/**
 * 목록 카드 썸네일(04 F-04)의 기준 폭(px). `RecordCard.module.css`의 `.thumbWrap { width }`와
 * 같은 값이어야 한다 — 여기만 키우면 대역폭만 늘고, 여기만 줄이면 흐릿해진다.
 */
const CARD_THUMB_WIDTH_PX = 88
/** 04 §6: "카드 썸네일 기준 폭 이하로 다운스케일 + DPR 2배까지만" */
const MAX_DPR = 2

/**
 * 목록 카드 썸네일용 서명 URL (04 §6).
 *
 * 원본은 긴 변 2,048px·최대 1.5MB인데(05 F-18) 카드에서는 88px 폭으로 그려진다. 그대로
 * 보내면 한 페이지(20장)에 30MB가 오갈 수 있어서 Storage 변환 파라미터로 미리 줄여 받는다.
 *
 * **배치 API(`createSignedUrls`)를 쓰지 않는다.** supabase-js 2.112 기준 `transform`을 받는
 * 건 단건 `createSignedUrl`뿐이다(배치 엔드포인트의 요청 본문에 transform 자리가 없다).
 * 그래서 장수만큼 병렬 요청이 나가는데, 애초에 04 §4.1이 "서명 URL은 화면에 보이는 카드
 * 것만 발급한다"고 정한 방향이라 페이지당 최대 20건은 감수한다.
 *
 * `resize: 'contain'` + 폭만 지정: 높이를 비워 두면 원본 비율이 유지된다. `record_photos`에
 * 저장된 width/height로 잡아둔 자리와 비율이 어긋나지 않아야 CLS 0이 유지된다(04 §6).
 *
 * @param paths Storage 경로 목록
 * @returns 경로 → 서명 URL. 실패한 항목은 맵에서 빠진다(호출부가 대체 표시)
 */
export async function signThumbnailUrls(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed
  const width = CARD_THUMB_WIDTH_PX * MAX_DPR
  const results = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600, { transform: { width, resize: 'contain' } })
      return error !== null || data === null ? null : ([path, data.signedUrl] as const)
    }),
  )
  for (const item of results) {
    if (item !== null) signed.set(item[0], item[1])
  }
  return signed
}
