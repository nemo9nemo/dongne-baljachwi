import { supabase } from '../../lib/supabase'
import type { PhotoContentType } from '../../lib/database.types'

/**
 * 사진 전처리·업로드 (05 F-18~F-21).
 *
 * 이 화면의 실질적 난이도는 입력 폼이 아니라 여기다 (스펙 §1). 원본을 그대로 올리면
 * 모바일 업로드가 자주 실패하고 스토리지 비용이 선형으로 늘며, EXIF에 박힌 GPS 좌표가
 * 그대로 남는다.
 */

/** F-15 / 00 §4.6. DB의 `sort_order between 0 and 4`와 같은 값이어야 한다 */
export const MAX_PHOTOS = 5

/** F-20. Storage 버킷의 file_size_limit(10MB)과 같은 값 */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

/** F-18. 리사이즈 후 긴 변 상한 */
export const MAX_EDGE_PX = 2048

/** F-18. 재인코딩 목표 크기. 넘으면 품질을 한 단계씩 내린다 */
const TARGET_BYTES = Math.round(1.5 * 1024 * 1024)

/**
 * F-20. 파일 선택 대화상자와 검증이 같은 목록을 본다.
 *
 * HEIC/HEIF는 **의도적으로 제외**한다 (§9 미결정 항목에 대한 판단):
 * Android Chrome은 HEIC를 canvas로 디코딩하지 못해 리사이즈·EXIF 제거가 아예 불가능하다.
 * 디코딩 라이브러리(수백 KB)를 번들에 넣는 대신 거부하고 안내한다. iOS 기본 설정이
 * "높은 호환성"이면 촬영본이 JPEG이고, HEIC로 찍었어도 브라우저 파일 선택기가
 * JPEG로 변환해 넘겨주는 경우가 많다.
 */
export const ACCEPTED_MIME: readonly PhotoContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

/** 선택 시점 검증 실패 사유 (F-20, 검증은 선택 시점) */
export type PhotoRejection = 'too-large' | 'unsupported-type'

export function rejectionOf(file: File): PhotoRejection | null {
  // 확장자가 아니라 MIME으로 본다. HEIC는 type이 'image/heic' 또는 빈 문자열로 온다.
  if (!ACCEPTED_MIME.includes(file.type as PhotoContentType)) return 'unsupported-type'
  if (file.size > MAX_SOURCE_BYTES) return 'too-large'
  return null
}

export function rejectionMessage(rejection: PhotoRejection, fileName: string): string {
  switch (rejection) {
    case 'too-large':
      return `${fileName} — 10MB 이하 이미지만 올릴 수 있어요.`
    case 'unsupported-type':
      return `${fileName} — JPG·PNG·WebP만 올릴 수 있어요. 아이폰 HEIC 사진이면 다른 형식으로 저장해주세요.`
  }
}

/** 리사이즈·재인코딩을 마친 업로드 대상 */
export type PreparedPhoto = {
  blob: Blob
  contentType: PhotoContentType
  /** 리사이즈 **후** 픽셀 크기. record_photos.width/height 로 그대로 들어간다 (레이아웃 시프트 방지) */
  width: number
  height: number
  byteSize: number
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * 방향이 적용된 비트맵으로 디코딩한다 (F-19).
 *
 * `imageOrientation: 'from-image'`가 EXIF Orientation을 픽셀에 반영해 준다. 이걸 빼면
 * 세로로 찍은 아이폰 사진이 눕는다 — 원본에는 회전 정보만 있고 픽셀은 가로이기 때문이다.
 * 옵션을 모르는 구형 엔진은 그 자리에서 throw하므로 <img> 경로로 떨어뜨린다
 * (최신 브라우저의 <img>는 image-orientation: from-image가 기본값이라 방향이 맞는다).
 */
async function decodeOriented(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }
}

/**
 * F-18/F-19: 긴 변 2,048px 이하로 줄이고 JPEG으로 다시 인코딩한다.
 *
 * **원본이 이미 작고 가벼워도 반드시 재인코딩한다.** 리사이즈가 아니라 메타데이터 제거가
 * 목적이기 때문이다 — canvas는 픽셀만 들고 있어서 결과 JPEG에는 EXIF(GPS·기기·촬영시각)가
 * 통째로 없다. 원본을 조건부로 통과시키면 그 경로로 GPS가 새어 나간다.
 *
 * WebP 대신 JPEG으로 고정한 이유: 사진 콘텐츠라 JPEG로도 목표 용량을 맞출 수 있고,
 * 인코딩 지원 여부를 런타임에 탐지하는 분기를 만들 이유가 없다.
 *
 * @throws 디코딩 실패(손상된 파일 등). 호출부가 그 사진만 거부한다.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const decoded = await decodeOriented(file)
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('canvas 2d context를 얻지 못했다')

    // 투명 PNG를 JPEG로 인코딩하면 투명 픽셀이 검게 깔린다. 흰 바탕을 먼저 칠한다.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(decoded.source, 0, 0, width, height)

    // 품질 사다리. 대부분 첫 단계에서 목표(1.5MB) 안에 들어오고, 텍스처가 많은 사진만
    // 아래로 내려간다. 마지막 단계는 목표를 못 맞춰도 그대로 쓴다 — 여기서 더 깎으면
    // 눈에 띄게 뭉개지고, Storage 상한(10MB)에는 어차피 한참 못 미친다.
    let blob: Blob | null = null
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      blob = await toBlob(canvas, quality)
      if (blob === null) throw new Error('이미지를 인코딩하지 못했다')
      if (blob.size <= TARGET_BYTES) break
    }
    if (blob === null) throw new Error('이미지를 인코딩하지 못했다')

    return { blob, contentType: 'image/jpeg', width, height, byteSize: blob.size }
  } finally {
    decoded.release()
  }
}

/** F-21 / 00 §4.6: 첫 세그먼트가 Storage RLS의 격리 축이다 */
export function photoStoragePath(
  coupleId: string,
  recordId: string,
  photoId: string,
): string {
  return `${coupleId}/${recordId}/${photoId}.jpg`
}

const BUCKET = 'record-photos'

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

/** 기존 사진 썸네일용 서명 URL (00 §4.6: 공개 URL을 쓰지 않는다) */
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
