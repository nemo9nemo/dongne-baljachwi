import type { Mood, Weather } from '../../lib/database.types'
import { MOODS, WEATHERS } from '../../lib/mood-weather'
import { formatVisitedOn } from '../../lib/format-date'

/**
 * 기록 카드 PNG 합성 (`docs/specs/10-record-card-image.md`).
 *
 * 완전한 클라이언트 기능이다 (§1, F-14) — 여기서 만들어진 Blob은 사용자의 다운로드 폴더로만
 * 나가고, 어떤 요청도 서버로 보내지 않는다. 콘솔에 data URL을 남기지도 않는다 (§4.3).
 *
 * UI에서 분리한 이유는 F-16 때문이다: 카드는 화면 스크린샷이 아니라 **공유용으로 다시 조판한
 * 결과물**이라, 화면 컴포넌트와 레이아웃을 공유할 수 없다. 입력(`CardInput`)과 레이아웃을
 * 갈라 두면 §7의 "정사각형·스토리 비율 추가"가 이 파일 교체로 끝난다.
 */

/** F-06: 카드 논리 좌표계. 실제 픽셀은 여기에 `CARD_SCALE`을 곱한다 */
export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350
/** F-06/AC-03: 2배로 렌더해 2160×2700 PNG를 만든다. 등배로 뽑으면 한글이 뭉갠다 */
export const CARD_SCALE = 2

/** F-08: 그리드에 실제로 들어가는 사진 수. 초과분은 "+N"으로만 표기한다 */
export const MAX_CARD_PHOTOS = 4

/** F-10: 카드에 찍는 태그 수 상한 */
const MAX_CARD_TAGS = 5

/**
 * 사진 한 장의 로드 마감. 넘으면 그 사진만 버린다.
 * §6.2의 3초 예산보다 넉넉한 이유: 느린 모바일 회선에서 "조금 늦게라도 나오는" 쪽이
 * "사진이 빠진 카드"보다 낫다. 다만 무한정 기다리지는 않는다.
 */
const PHOTO_LOAD_TIMEOUT_MS = 8000

const FONT_FAMILY = "'Noto Sans KR', sans-serif"

// ── 레이아웃 상수 (논리 px) ──────────────────────────────────────────────
// docs/design/record-card-review.md §3 — 디자이너 조판 스펙 이관분 (2026-08-20).
const PAD = 72
const CONTENT_WIDTH = CARD_WIDTH - PAD * 2

// 사진 블록. 고정 높이 대신 일기 줄 수로 역산한 적응형 높이를 쓴다 (§3.3).
const PHOTO_GAP = 16
const PHOTO_RADIUS = 24
const PHOTO_MIN = 520
const PHOTO_MAX = 780
const PHOTO_NOTE_GAP = 48
/** 세로 사진 커버 크롭 시 위쪽을 더 남긴다(0.5=정중앙). 인물이 화면 위쪽 1/3에 오는 경우가 많다 */
const PHOTO_CROP_ANCHOR = 0.38

// 칩 — 감정·날씨(채움)와 태그(윤곽)는 형태로 층위를 가른다 (§3.4)
const CHIP_HEIGHT = 60
const CHIP_FONT_SIZE = 30
const CHIP_PAD_X = 30
const TAG_HEIGHT = 52
const TAG_FONT_SIZE = 28
const TAG_PAD_X = 26
/** "+N" 배지. 칩 높이(CHIP_HEIGHT)가 바뀌어도 따라 커지지 않도록 독립 상수로 둔다 */
const BADGE_HEIGHT = 48

// 타이포 위계 4단계 — ÷2.25로 환산하면 앱의 display/md/sm/xs와 겹친다 (§3.1)
const STATION_FONT_SIZE = 72
/** 역명이 CONTENT_WIDTH를 넘으면 한 단계 내린 뒤에도 넘치면 말줄임한다 */
const STATION_FONT_SIZE_SMALL = 56
const DATE_FONT_SIZE = 30
const NOTE_FONT_SIZE = 34
const NOTE_LINE_HEIGHT = 52
/** 사진이 있을 때 일기 최대 줄 수. 사진 블록 높이 역산에도 같은 값을 쓴다 */
const NOTE_MAX_LINES = 5
/** 사진이 없는 카드(F-04 폴백 포함): 일기가 유일한 콘텐츠라 더 크게 키운다 */
const NOTE_FONT_SIZE_SOLO = 44
const NOTE_LINE_HEIGHT_SOLO = 68

/** 워터마크 자간(em 비율). `ctx.letterSpacing`은 브라우저 지원이 갈려 AC-13을 깨므로
 *  글자별로 직접 그려 트래킹한다 (§3.5) */
const WATERMARK_LETTER_SPACING_EM = 0.18
const WATERMARK_FONT_SIZE = 30
/** 카드 바닥에서 워터마크 베이스라인까지 남기는 여백(§3.2 앵커 공식의 값 그대로) */
const WATERMARK_BOTTOM_MARGIN = 34
/** 발자국 마크(Wordmark `.brandMark`를 canvas 원 두 개로 옮긴 것) 한 변 */
const WATERMARK_MARK_SIZE = 34

/** F-03: 워터마크 문구. 2026-08-19 사용자 결정으로 "동네 발자취" 고정. 서비스명이 바뀌면
 *  파일명(F-11, `cardFileName` 접두사)과 함께 고쳐야 한다 */
const WATERMARK_TEXT = '동네 발자취'

/**
 * "+N" 배지 뒤에 까는 스크림. 사진 밝기를 알 수 없어 팔레트 색으로는 대비를 보장할 수 없다 —
 * `PhotoViewer`의 오버레이 버튼과 같은 이유로 반투명 검정을 쓴다.
 */
const SCRIM = 'rgb(0 0 0 / 62%)'

export type CardPhoto = {
  id: string
  /** Storage 서명 URL. 발급 실패로 null이면 그 사진은 실패로 집계한다 (§4.3: 공개 URL 금지) */
  url: string | null
}

/** §4.1 "카드 렌더 입력 계약". 기록 상세가 이미 가진 `RecordDetail`을 그대로 옮겨 담는다 */
export type CardInput = {
  stationName: string
  /** `YYYY-MM-DD` */
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  /** 전문을 그대로 받는다 — 자르는 건 렌더 단계 몫이다 (F-09) */
  note: string | null
  tags: string[]
  photos: CardPhoto[]
}

export type LoadedPhoto = {
  source: CanvasImageSource
  width: number
  height: number
  /** objectURL 해제 등. 두 번 불러도 안전하다 */
  release: () => void
}

export type PhotoLoadResult = {
  images: LoadedPhoto[]
  /** 로드에 실패해 카드에서 빠진 장수. 0보다 크면 §5의 "부분 성공"을 안내한다 */
  failedCount: number
  /** F-08/AC-05: 그리드에 못 들어간 초과분. 카드에 "+N"으로 찍는다 */
  extraCount: number
}

/**
 * 웹폰트 로드를 보장한다 (§6.3, AC-13).
 *
 * canvas는 CSS와 달리 폰트가 아직 없으면 **조용히 대체 폰트로 그리고 끝난다.** 기다리지 않으면
 * 기기마다 자간·줄바꿈 위치가 달라진다.
 *
 * @param sample 실제로 카드에 그릴 문자열. fontsource가 Noto Sans KR을 유니코드 서브셋으로
 *   쪼개 배포하므로, 텍스트 없이 `load()`만 부르면 라틴 서브셋만 받아 오고 한글은 여전히
 *   대체 폰트로 그려진다.
 */
export async function ensureCardFontsReady(sample: string): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 ${NOTE_FONT_SIZE}px ${FONT_FAMILY}`, sample),
      document.fonts.load(`500 ${NOTE_FONT_SIZE}px ${FONT_FAMILY}`, sample),
      document.fonts.load(`700 ${NOTE_FONT_SIZE}px ${FONT_FAMILY}`, sample),
    ])
    await document.fonts.ready
  } catch {
    // 폰트를 못 받아도 대체 폰트로 카드는 나온다. 기능을 막을 이유가 없다.
  }
}

/** 폰트 로드 힌트로 넘길 표본. 카드에 등장할 글자를 빠짐없이 모은다 */
export function cardTextSample(input: CardInput): string {
  const { dateLabel, weekday } = formatVisitedOn(input.visitedOn)
  return [
    input.stationName,
    `${dateLabel} (${weekday})`,
    input.note ?? '',
    input.tags.map((tag) => `#${tag}`).join(' '),
    MOODS.map((item) => item.label).join(''),
    WEATHERS.map((item) => item.label).join(''),
    WATERMARK_TEXT,
    '0123456789+…',
  ].join(' ')
}

/**
 * 사진 한 장을 canvas에 그릴 수 있는 형태로 가져온다 (F-05, §6.1의 대비책 ①②).
 *
 * ① `crossOrigin='anonymous'`로 서명 URL을 그대로 로드한다. 이 모드는 CORS 헤더가 없으면
 *    **오염된 채 로드되는 게 아니라 로드 자체가 실패**하므로, 성공했다면 canvas는 깨끗하다.
 * ② 실패하면 `fetch`로 받아 Blob→objectURL로 바꿔 그린다. objectURL은 같은 출처라 오염되지
 *    않는다. `cache: 'reload'`인 이유가 핵심이다 — 화면(`<img>` 썸네일)이 CORS 헤더 없이
 *    받아 캐시에 넣어 둔 응답을 브라우저가 재사용하면 ①이 영문 모를 이유로 계속 실패한다.
 *    강제 재검증으로 그 캐시를 건너뛴다.
 *
 * 버킷을 public으로 바꾸는 것은 대비책이 아니다 (§4.3) — 그 순간 커플 격리가 깨진다.
 */
async function loadOnePhoto(url: string, signal: AbortSignal): Promise<LoadedPhoto> {
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => undefined,
    }
  } catch {
    const response = await fetch(url, { mode: 'cors', cache: 'reload', signal })
    if (!response.ok) throw new Error(`사진을 받지 못했다 (${response.status})`)
    const objectUrl = URL.createObjectURL(await response.blob())
    try {
      const image = new Image()
      image.src = objectUrl
      await image.decode()
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl),
      }
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }
  }
}

/**
 * 카드에 넣을 사진을 모은다. 한 장이 실패해도 나머지로 진행한다 (§5 "부분 성공", AC-08).
 *
 * 실패한 자리를 빈 칸으로 남기지 않고 성공한 장수에 맞춰 그리드를 다시 잡는다 — 빈 사각형이
 * 박힌 카드를 공유하고 싶은 사람은 없다. 무엇이 빠졌는지는 `failedCount`로 알린다.
 */
export async function loadCardPhotos(
  photos: readonly CardPhoto[],
  signal: AbortSignal,
): Promise<PhotoLoadResult> {
  const targets = photos.slice(0, MAX_CARD_PHOTOS)
  const images: LoadedPhoto[] = []
  let failedCount = 0

  // 병렬로 받는다. 순차로 돌리면 4장 × RTT가 그대로 §6.2의 3초 예산을 먹는다.
  const settled = await Promise.all(
    targets.map(async (photo) => {
      if (photo.url === null) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        // 마감을 걸지 않으면 응답이 오지 않는 사진 한 장 때문에 미리보기가 영영 안 뜬다.
        // 그 사진만 포기하고 나머지로 카드를 만드는 편이 언제나 낫다 (§5 부분 성공).
        return await Promise.race([
          loadOnePhoto(photo.url, signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('사진 로드 시간 초과')), PHOTO_LOAD_TIMEOUT_MS)
          }),
        ])
      } catch {
        return null
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }),
  )

  for (const item of settled) {
    if (item === null) failedCount += 1
    else images.push(item)
  }

  return {
    images,
    failedCount,
    // 실패분과 초과분은 별개로 센다. 4장 중 1장이 실패했다고 5번째 사진을 끌어올리면
    // 사용자가 "왜 이 사진이 들어갔지"를 알 방법이 없다.
    extraCount: Math.max(0, photos.length - MAX_CARD_PHOTOS),
  }
}

/**
 * 카드 색 (2026-08-19 사용자 결정).
 *
 * 카드는 생성 시점의 앱 테마를 따른다 — 다크 모드는 검정 배경 + 흰 테두리, 라이트는 흰
 * 배경 + 검정 테두리. 그래서 시맨틱 토큰이 아니라 **원시 팔레트를 읽되, 현재 테마를 직접
 * 판별해서** 어느 쌍을 쓸지 고른다(시맨틱 `--color-*`를 그대로 쓰지 않는 이유는 라이트의
 * `--color-bg`가 순백이 아니라 `--gray-50`이라 미묘하게 오프화이트가 되기 때문 — 카드는
 * 순수 흑/백을 원한다).
 */
function cardPalette() {
  const root = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => {
    const value = root.getPropertyValue(name).trim()
    return value === '' ? fallback : value
  }
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const white = read('--white', '#ffffff')
  const black = read('--black', '#000000')
  // "+N" 배지는 항상 반투명 검정 스크림 위에 그린다(SCRIM) — 스크림이 테마와 무관하게
  // 어두우므로 그 위 글자는 테마와 무관하게 항상 흰색이어야 읽힌다. 다크에서 palette.bg(검정)를
  // 쓰면 검정 위에 검정이라 대비 1:1이 된다(review §3.7 D-1).
  const onScrim = white
  return dark
    ? {
        bg: black,
        text: white,
        muted: read('--gray-400', '#a3a3a3'),
        border: white,
        onScrim,
      }
    : {
        bg: white,
        text: black,
        muted: read('--gray-600', '#525252'),
        border: black,
        onScrim,
      }
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_FAMILY}`
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // `ctx.roundRect`를 쓰지 않는다 — 구형 iOS Safari에 없어서 분기를 하나 더 만들어야 한다.
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 한 줄에 안 들어가면 뒤를 잘라 말줄임한다 (역명처럼 줄바꿈하면 안 되는 값) */
function fitOneLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let head = text
  while (head.length > 1 && ctx.measureText(`${head}…`).width > maxWidth) head = head.slice(0, -1)
  return `${head}…`
}

/**
 * §6.3: 한글 줄바꿈은 **어절 단위**로 한다. 글자 단위로 끊으면 카드가 읽히지 않는다.
 * 다만 공백 없는 긴 토큰(URL, 이어 쓴 문장)은 어절 단위로는 영영 안 들어가므로 그때만
 * 글자 단위로 강제 분해한다.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      if (word === '') continue
      const candidate = line === '' ? word : `${line} ${word}`
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      if (ctx.measureText(word).width <= maxWidth) {
        line = word
        continue
      }
      let chunk = ''
      for (const char of word) {
        if (chunk !== '' && ctx.measureText(chunk + char).width > maxWidth) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      line = chunk
    }
    // 빈 문단(연속 개행)도 한 줄로 남긴다 — 사용자가 넣은 문단 구분이다.
    lines.push(line)
  }
  return lines
}

type Rect = { x: number; y: number; w: number; h: number }

/**
 * F-08: 1장=전체 / 2장=좌우 2분할 / 3~4장=그리드.
 *
 * 3장일 때 2×2 그리드에 빈 칸을 남기지 않고 첫 장을 왼쪽 전체 높이로 키운다 — 빈 칸이 보이면
 * "사진을 못 불러왔나?"로 읽힌다.
 */
function photoSlots(count: number, x: number, y: number, w: number, h: number): Rect[] {
  const halfW = (w - PHOTO_GAP) / 2
  const halfH = (h - PHOTO_GAP) / 2
  const rightX = x + halfW + PHOTO_GAP
  const lowerY = y + halfH + PHOTO_GAP
  switch (count) {
    case 1:
      return [{ x, y, w, h }]
    case 2:
      return [
        { x, y, w: halfW, h },
        { x: rightX, y, w: halfW, h },
      ]
    case 3:
      return [
        { x, y, w: halfW, h },
        { x: rightX, y, w: halfW, h: halfH },
        { x: rightX, y: lowerY, w: halfW, h: halfH },
      ]
    default:
      return [
        { x, y, w: halfW, h: halfH },
        { x: rightX, y, w: halfW, h: halfH },
        { x, y: lowerY, w: halfW, h: halfH },
        { x: rightX, y: lowerY, w: halfW, h: halfH },
      ]
  }
}

function drawCover(ctx: CanvasRenderingContext2D, photo: LoadedPhoto, rect: Rect): void {
  ctx.save()
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, PHOTO_RADIUS)
  ctx.clip()
  const scale = Math.max(rect.w / photo.width, rect.h / photo.height)
  const drawW = photo.width * scale
  const drawH = photo.height * scale
  ctx.drawImage(
    photo.source,
    rect.x + (rect.w - drawW) / 2,
    // 정중앙(0.5)이 아니라 위쪽을 더 남긴다(PHOTO_CROP_ANCHOR) — 데이트 사진은 인물이
    // 화면 위쪽 1/3에 있는 경우가 많아, 가로로 긴 슬롯에 세로 사진을 채우면 정중앙 크롭은
    // 얼굴을 자른다 (review §2.2-⑥).
    rect.y + (rect.h - drawH) * PHOTO_CROP_ANCHOR,
    drawW,
    drawH,
  )
  ctx.restore()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 채움 알약(감정·날씨). 태그가 윤곽인 것과 대비해 "이건 상위 정보"임을 형태로 알린다
 * (review §3.4 — `tokens.css`의 primary/danger "채움 vs 윤곽" 문법과 같은 논리).
 * 반환값은 다음 칩이 시작할 x.
 */
function drawFilledPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  color: string,
  fontSize: number,
  height: number,
  padX: number,
): number {
  ctx.font = font(500, fontSize)
  const width = ctx.measureText(text).width + padX * 2
  ctx.fillStyle = bg
  roundRectPath(ctx, x, y, width, height, height / 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX, y + height / 2)
  ctx.textBaseline = 'top'
  return x + width
}

/** 윤곽 알약(태그). 이모지를 뺀 지금, 칩의 형태 자체가 "이건 감정/날씨가 아니라 태그다"를
 *  전달하는 유일한 신호라 채움과 뚜렷이 달라야 한다 (review §3.4). */
function drawOutlinePill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  border: string,
  color: string,
  fontSize: number,
  height: number,
  padX: number,
): number {
  ctx.font = font(500, fontSize)
  const width = ctx.measureText(text).width + padX * 2
  ctx.strokeStyle = border
  ctx.lineWidth = 2
  // 1px 인셋 — 선을 알약 경계에 그대로 그리면 절반이 잘려 나가 실제보다 가늘어 보인다.
  roundRectPath(ctx, x + 1, y + 1, width - 2, height - 2, (height - 2) / 2)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX, y + height / 2)
  ctx.textBaseline = 'top'
  return x + width
}

export type RenderResult = {
  /** F-09: 일기가 잘렸는지. 미리보기에서 잘렸음을 알려야 한다 (§2.2) */
  noteTruncated: boolean
}

/**
 * 카드를 canvas에 그린다. 미리보기와 최종 출력이 **같은 함수·같은 캔버스**를 쓰므로
 * §6.3의 "미리보기와 실제 출력의 레이아웃이 동일해야 한다"가 구조적으로 보장된다.
 *
 * @param canvas 렌더 대상. 크기를 `CARD_WIDTH*CARD_SCALE × CARD_HEIGHT*CARD_SCALE`로 덮어쓴다
 * @param photos `loadCardPhotos`가 성공적으로 가져온 것만. 빈 배열이면 텍스트 전용 레이아웃
 * @param extraPhotoCount F-08의 "+N"에 찍을 수. 0이면 배지를 그리지 않는다
 * @throws canvas 2D 컨텍스트를 얻지 못한 경우
 */
export async function renderCard(
  canvas: HTMLCanvasElement,
  input: CardInput,
  photos: readonly LoadedPhoto[],
  extraPhotoCount: number,
): Promise<RenderResult> {
  canvas.width = CARD_WIDTH * CARD_SCALE
  canvas.height = CARD_HEIGHT * CARD_SCALE
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('canvas 2d context를 얻지 못했다')

  // 이후 좌표를 전부 논리 px로 쓴다. 배율만 바뀌면 같은 레이아웃이 그대로 확대된다 (F-06).
  ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0)
  const palette = cardPalette()

  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  // 흰 배경 위(카톡·인스타)에 올리면 카드 경계가 사라진다. 헤어라인으로 가장자리를 남긴다.
  // 3px인 이유: 카톡 썸네일 표시 크기(≈480px)로 줄이면 2px는 0.9px가 되어 렌더 아티팩트로
  // 보인다(review §3.5) — 3px라야 "의도된 프레임"으로 읽힌다.
  ctx.strokeStyle = palette.border
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, CARD_WIDTH - 3, CARD_HEIGHT - 3)

  ctx.textBaseline = 'top'
  let y = PAD

  // 역명: 72px가 CONTENT_WIDTH를 넘으면 56px로 한 단계 내리고, 그래도 넘치면 말줄임한다
  // (review §3.1 — 긴 역명이 그냥 잘리던 문제).
  ctx.font = font(700, STATION_FONT_SIZE)
  const stationFits = ctx.measureText(input.stationName).width <= CONTENT_WIDTH
  if (!stationFits) ctx.font = font(700, STATION_FONT_SIZE_SMALL)
  ctx.fillStyle = palette.text
  ctx.fillText(fitOneLine(ctx, input.stationName, CONTENT_WIDTH), PAD, y)
  y += 92

  const { dateLabel, weekday } = formatVisitedOn(input.visitedOn)
  ctx.font = font(400, DATE_FONT_SIZE)
  ctx.fillStyle = palette.muted
  ctx.fillText(`${dateLabel} (${weekday})`, PAD, y)
  y += 42

  // 2026-08-19 사용자 결정: 텍스트 우선, 이모지는 나중에 태그를 활용해 별도로 추가한다.
  // 이모지는 OS마다 모양이 달라 AC-13(기기 간 동일성)을 깨는 원인이었다 — 라벨 텍스트만
  // 쓰면 그 문제 자체가 없어진다. 채움 알약으로 그려 태그(윤곽)와 층위를 가른다(§3.4).
  const moodMeta = MOODS.find((item) => item.slug === input.mood) ?? null
  const weatherMeta = WEATHERS.find((item) => item.slug === input.weather) ?? null
  if (moodMeta !== null || weatherMeta !== null) {
    let chipX = PAD
    if (moodMeta !== null) {
      chipX =
        drawFilledPill(
          ctx,
          moodMeta.label,
          chipX,
          y,
          palette.text,
          palette.bg,
          CHIP_FONT_SIZE,
          CHIP_HEIGHT,
          CHIP_PAD_X,
        ) + 16
    }
    if (weatherMeta !== null) {
      drawFilledPill(
        ctx,
        weatherMeta.label,
        chipX,
        y,
        palette.text,
        palette.bg,
        CHIP_FONT_SIZE,
        CHIP_HEIGHT,
        CHIP_PAD_X,
      )
    }
    y += CHIP_HEIGHT + 36
  } else {
    y += 20
  }

  // 아래쪽 고정 블록(구분선 → 워터마크, 그 위에 태그)을 먼저 잡는다. 사진·일기가 나눠 쓸
  // 영역(NOTE_BOTTOM까지)의 바닥이 정해져야 사진 높이를 역산할 수 있다(F-09, §3.3).
  const watermarkTop = CARD_HEIGHT - PAD - WATERMARK_BOTTOM_MARGIN
  const ruleY = watermarkTop - 28
  const visibleTags = input.tags.slice(0, MAX_CARD_TAGS)
  const tagsTop = visibleTags.length > 0 ? ruleY - 36 - TAG_HEIGHT : ruleY
  const noteBottom = tagsTop - 36

  let noteTruncated = false
  const note = input.note?.trim() ?? ''
  const hasPhotos = photos.length > 0

  if (hasPhotos) {
    // §3.3 핵심 변경: 일기를 사진보다 먼저 "측정"해서(그리지는 않는다) 사진 블록에 줄
    // 높이를 역산한다 — 짧은 일기(대다수)는 사진이 커지고, 긴 일기는 5줄까지 안 잘린다.
    ctx.font = font(400, NOTE_FONT_SIZE)
    const wrapped = note === '' ? [] : wrapText(ctx, note, CONTENT_WIDTH)
    const noteLinesForSizing = Math.min(wrapped.length, NOTE_MAX_LINES)
    const photoH = clamp(
      noteBottom - y - PHOTO_NOTE_GAP - noteLinesForSizing * NOTE_LINE_HEIGHT,
      PHOTO_MIN,
      PHOTO_MAX,
    )

    const slots = photoSlots(photos.length, PAD, y, CONTENT_WIDTH, photoH)
    for (let i = 0; i < photos.length; i += 1) {
      const slot = slots[i]
      const photo = photos[i]
      if (slot === undefined || photo === undefined) continue
      drawCover(ctx, photo, slot)
      // §6.2: 2160×2700 캔버스에 큰 사진을 그리는 건 장당 수십 ms다. 4장을 한 태스크에서
      // 처리하면 메인 스레드가 눈에 띄게 멈춘다("얼었다"로 읽힌다). 슬롯마다 태스크 경계를
      // 만들어 그 사이에 UI 이벤트가 끼어들 수 있게 한다.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const lastSlot = slots[photos.length - 1]
    if (extraPhotoCount > 0 && lastSlot !== undefined) {
      const label = `+${extraPhotoCount}`
      ctx.font = font(700, 30)
      const badgeW = ctx.measureText(label).width + 44
      const badgeX = lastSlot.x + lastSlot.w - badgeW - 20
      const badgeY = lastSlot.y + lastSlot.h - BADGE_HEIGHT - 20
      ctx.fillStyle = SCRIM
      roundRectPath(ctx, badgeX, badgeY, badgeW, BADGE_HEIGHT, BADGE_HEIGHT / 2)
      ctx.fill()
      // review §3.7 D-1: palette.bg가 아니라 항상 흰색(onScrim) — 다크 모드에서
      // 검정 글자를 검정 스크림 위에 그리면 대비가 1:1이 된다.
      ctx.fillStyle = palette.onScrim
      ctx.textBaseline = 'middle'
      ctx.fillText(label, badgeX + 22, badgeY + BADGE_HEIGHT / 2)
      ctx.textBaseline = 'top'
    }
    y += photoH + PHOTO_NOTE_GAP

    if (note !== '') {
      ctx.font = font(400, NOTE_FONT_SIZE)
      ctx.fillStyle = palette.text
      const maxLines = Math.floor((noteBottom - y) / NOTE_LINE_HEIGHT)
      const lines = wrapped.slice(0, Math.max(0, maxLines))
      if (lines.length < wrapped.length) {
        noteTruncated = true
        const lastIndex = lines.length - 1
        let last = lines[lastIndex] ?? ''
        while (last !== '' && ctx.measureText(`${last}…`).width > CONTENT_WIDTH) last = last.slice(0, -1)
        if (lastIndex >= 0) lines[lastIndex] = `${last}…`
      }
      for (let i = 0; i < lines.length; i += 1) {
        ctx.fillText(lines[i] ?? '', PAD, y + i * NOTE_LINE_HEIGHT)
      }
    }
  } else if (note !== '') {
    // 사진 없는 카드(F-04 폴백 포함): 일기가 유일한 콘텐츠라 큰 글자로 상단 정렬한다.
    // 본문 크기(34px)로 두면 1350 높이 카드에 두 줄만 떠 "실패한 카드"로 보인다(review §3.3).
    ctx.font = font(400, NOTE_FONT_SIZE_SOLO)
    ctx.fillStyle = palette.text
    const maxLines = Math.floor((noteBottom - y) / NOTE_LINE_HEIGHT_SOLO)
    const wrapped = wrapText(ctx, note, CONTENT_WIDTH)
    const lines = wrapped.slice(0, Math.max(0, maxLines))
    if (lines.length < wrapped.length) {
      noteTruncated = true
      const lastIndex = lines.length - 1
      let last = lines[lastIndex] ?? ''
      while (last !== '' && ctx.measureText(`${last}…`).width > CONTENT_WIDTH) last = last.slice(0, -1)
      if (lastIndex >= 0) lines[lastIndex] = `${last}…`
    }
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i] ?? '', PAD, y + i * NOTE_LINE_HEIGHT_SOLO)
    }
  }

  // F-10: 최대 5개 + "+N". 다만 5개여도 폭을 넘길 수 있어(긴 태그) 실제로 들어간 만큼만 세고
  // 나머지는 초과분에 합친다 — 칩이 카드 밖으로 삐져나가는 것보다 낫다. 태그는 윤곽 알약이다
  // (§3.4) — 채움인 감정·날씨와 형태로 구분된다.
  if (visibleTags.length > 0) {
    let tagX = PAD
    let drawn = 0
    ctx.font = font(500, TAG_FONT_SIZE)
    for (const tag of visibleTags) {
      const label = `#${tag}`
      const width = ctx.measureText(label).width + TAG_PAD_X * 2
      if (drawn > 0 && tagX + width > PAD + CONTENT_WIDTH) break
      tagX =
        drawOutlinePill(ctx, label, tagX, tagsTop, palette.muted, palette.muted, TAG_FONT_SIZE, TAG_HEIGHT, TAG_PAD_X) +
        12
      drawn += 1
    }
    const restCount = input.tags.length - drawn
    if (restCount > 0) {
      const label = `+${restCount}`
      const width = ctx.measureText(label).width + TAG_PAD_X * 2
      if (tagX + width <= PAD + CONTENT_WIDTH) {
        drawOutlinePill(ctx, label, tagX, tagsTop, palette.muted, palette.muted, TAG_FONT_SIZE, TAG_HEIGHT, TAG_PAD_X)
      }
    }
  }

  // F-03: 공유 대체재이므로 출처를 남긴다. 전폭 실선+가운데 정렬(각주 톤) 대신, 좌측 축에
  // 맞춘 짧은 룰 + 발자국 마크 + 로고타입으로 그린다 — 앱 워드마크(`Wordmark.tsx`) 규격을
  // canvas로 옮긴 것이다(review §3.5). 전폭 순색 실선은 카드 테두리와 시각적으로 경쟁했다.
  ctx.strokeStyle = palette.text
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(PAD, ruleY)
  ctx.lineTo(PAD + 120, ruleY)
  ctx.stroke()

  // 발자국 마크: 대각선으로 겹친 원 두 개(뒤쪽은 반투명) — `.brandMark`와 같은 모티프.
  // review §3.5: 앞 중심 (PAD+9.5, watermarkTop+7.5) 불투명 / 뒤 중심
  // (PAD+24.5, watermarkTop+26.5) alpha 0.5. WATERMARK_MARK_SIZE(34) 영역 안에 겹쳐 앉는다.
  const dotR = 7.5
  ctx.fillStyle = palette.text
  ctx.beginPath()
  ctx.arc(PAD + 9.5, watermarkTop + 7.5, dotR, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.arc(PAD + 24.5, watermarkTop + 26.5, dotR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 로고타입: 자간을 CSS/letterSpacing에 기대지 않고 글자별로 직접 그린다 — 브라우저 지원
  // 편차로 AC-13(기기 간 동일성)이 깨지는 걸 막는다.
  ctx.font = font(700, WATERMARK_FONT_SIZE)
  ctx.fillStyle = palette.text
  let wx = PAD + WATERMARK_MARK_SIZE + 18
  for (const ch of WATERMARK_TEXT) {
    ctx.fillText(ch, wx, watermarkTop)
    wx += ctx.measureText(ch).width + WATERMARK_FONT_SIZE * WATERMARK_LETTER_SPACING_EM
  }

  return { noteTruncated }
}

/**
 * F-07: PNG로 인코딩한다.
 *
 * canvas가 오염됐다면 `toBlob`이 **동기로 SecurityError를 던진다.** 호출부가 그걸 잡아
 * §6.1 대비책 ③(사진 없는 텍스트 카드)로 떨어뜨릴 수 있도록 예외를 그대로 흘린다.
 *
 * §6.2의 "5MB 이하" 목표를 위한 사진 영역 JPEG 사전 압축은 **의도적으로 넣지 않았다** —
 * 업로드 단계(`photo-pipeline.preparePhoto`)에서 이미 긴 변 2048px JPEG으로 줄여 두어
 * 실측 없이 추가 압축 경로를 만들 근거가 없다. 실측에서 초과가 확인되면 그때 붙인다.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('PNG으로 인코딩하지 못했다'))
      else resolve(blob)
    }, 'image/png')
  })
}

/**
 * F-11: `동네발자취_{역명}_{YYYY-MM-DD}.png`.
 * 역명에 파일명으로 못 쓰는 문자가 들어가면(현재 마스터에는 없지만 향후 데이터가 바뀔 수 있다)
 * 브라우저가 저장 자체를 실패시키거나 이름을 멋대로 바꾸므로 미리 지운다.
 */
export function cardFileName(stationName: string, visitedOn: string): string {
  const safe = stationName
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return `동네발자취_${safe === '' ? '역' : safe}_${visitedOn}.png`
}
