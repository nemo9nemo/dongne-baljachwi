/**
 * 역명 정규화와 좌표 유틸 (docs/specs/02-station-master.md F-03).
 *
 * 그룹핑의 정확도가 통째로 이 파일의 규칙에 달려 있다. 규칙을 바꾸면 `stations.code`
 * (F-06)가 달라져 기존 기록이 다른 역을 가리킬 수 있으므로, 변경 시 반드시
 * `--dry-run` 차이 요약으로 영향 범위를 먼저 확인한다.
 */

/** 괄호 부기: `총신대입구(이수)` → `(이수)` 부분 */
const PAREN = /[(（][^)）]*[)）]/g;

/**
 * 노선도 라벨용 이름. 괄호 부기만 제거하고 나머지는 원문을 유지한다.
 * @param {string} name
 * @returns {string}
 */
export function toNameShort(name) {
  const stripped = name.normalize('NFC').replace(PAREN, '').replace(/\s+/g, ' ').trim();
  // 괄호를 지우고 나면 빈 문자열이 되는 이상 데이터가 있을 수 있다. 그때는 원문을 쓴다.
  return stripped.length > 0 ? stripped : name.normalize('NFC').trim();
}

/**
 * 그룹핑 비교용 키 (F-03).
 * NFC → 괄호 부기 제거 → 공백 전부 제거 → 접미사 '역' 제거 → 소문자.
 *
 * 접미사 '역' 을 두 글자 이상 남을 때만 떼는 이유: `역곡역` → `역곡` 은 맞지만
 * 원천에 단독 `역` 같은 값이 들어오면 빈 키가 되어 서로 다른 역이 전부 한 덩어리로 묶인다.
 *
 * @param {string} name
 * @returns {string}
 */
export function toNameKey(name) {
  let key = name.normalize('NFC').replace(PAREN, '').replace(/\s+/g, '');
  if (key.endsWith('역') && key.length >= 3) key = key.slice(0, -1);
  return key.toLowerCase();
}

/** 시도명 → 행정표준 시도 코드. region_code 가 NOT NULL 이라 주소에서라도 뽑아야 한다. */
const REGION_BY_PREFIX = /** @type {const} */ ({
  서울: '11', 부산: '26', 대구: '27', 인천: '28', 광주: '29',
  대전: '30', 울산: '31', 세종: '36', 경기: '41', 강원: '51',
  충청북도: '43', 충북: '43', 충청남도: '44', 충남: '44',
  전라북도: '52', 전북: '52', 전라남도: '46', 전남: '46',
  경상북도: '47', 경북: '47', 경상남도: '48', 경남: '48', 제주: '50',
});

/**
 * 소재지 주소 문자열에서 시도 코드를 추출한다. 못 찾으면 null.
 * @param {string|null|undefined} address
 * @returns {string|null}
 */
export function regionCodeFromAddress(address) {
  if (!address) return null;
  const head = address.normalize('NFC').trim();
  for (const [prefix, code] of Object.entries(REGION_BY_PREFIX)) {
    if (head.startsWith(prefix)) return code;
  }
  return null;
}

/**
 * 두 좌표 사이 거리(m). 그룹핑 임계값(F-02 500m) 판정에만 쓰므로 구면 근사로 충분하다.
 * @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2
 * @returns {number}
 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 좌표 유효성. 원천이 0,0 이나 위경도 스왑을 보내는 일이 실제로 있다.
 * 한반도 범위로 좁혀 경계에서 걸러낸다 — DB CHECK(-90..90)만으로는 스왑을 못 잡는다.
 * @param {number|null} lat @param {number|null} lng
 * @returns {boolean}
 */
export function isPlausibleKoreanCoord(lat, lng) {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

/**
 * 숫자로 읽히는 부분만 뽑아 정수로. 역번호 정렬(F-11 seq 파생)과 최소 역번호(F-06)에 쓴다.
 * @param {string|null|undefined} value
 * @returns {number|null}
 */
export function numericPart(value) {
  if (!value) return null;
  const m = String(value).match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : null;
}
