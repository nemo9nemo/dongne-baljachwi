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

/** 사진 썸네일용 서명 URL (00 §4.6: 공개 URL을 쓰지 않는다) */
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
