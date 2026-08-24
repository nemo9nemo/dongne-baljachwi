/**
 * 원천 어댑터 B — 전국도시철도역사정보표준데이터 (data.go.kr/15013205).
 *
 * 1,073행, **위경도·환승역여부·환승노선명 포함**, 연 1회 갱신. TAGO 와 달리 필요한 항목이
 * 전부 있는 것이 확인된 원천이라 폴백이 아니라 사실상 기본값에 가깝다 (02 §4.8).
 *
 * 파일 형식:
 *  - CSV: 의존성 없이 직접 파싱한다. 공공데이터 CSV 는 대개 CP949(EUC-KR) 라 인코딩을 감지한다.
 *  - XLSX: `xlsx` 패키지가 설치돼 있으면 쓰고, 없으면 CSV 로 저장하라고 안내한다.
 *    (XLSX 파서를 기본 의존성으로 넣지 않는 이유: 1년에 한 번 도는 배치 때문에 프로젝트
 *     전체에 파서를 물릴 이유가 없고, npm 의 xlsx 는 취약점 이력이 있는 버전이 최신이다.)
 */

import { readFile } from 'node:fs/promises';
import { numericPart, regionCodeFromAddress } from '../normalize.mjs';

/**
 * @typedef {import('../types.mjs').SourceRow} SourceRow
 *
 * xlsx 는 선택 의존성이라 타입 선언이 없다. 실제로 쓰는 두 API 만 좁게 선언한다.
 * @typedef {object} XlsxModule
 * @property {(path: string) => { SheetNames: string[], Sheets: Record<string, unknown> }} readFile
 * @property {{ sheet_to_json: (sheet: unknown, opts: { header: 1, raw: boolean, defval: string }) => string[][] }} utils
 */

/**
 * 표준데이터 컬럼명 후보. 표준데이터셋이라 이름이 고정이지만 연도별 표기 흔들림이 있어
 * 후보를 둔다. 전부 실패하면 실제 헤더 목록을 그대로 출력해 사람이 판단하게 한다.
 */
const COLUMNS = /** @type {const} */ ({
  stationName: ['역사명', '역명', '역사_명'],
  lineName:    ['노선명', '노선_명'],
  lineNo:      ['노선번호', '노선_번호'],
  stationNo:   ['역번호', '역사번호', '역_번호'],
  lat:         ['위도', '역위도', 'Y좌표'],
  lng:         ['경도', '역경도', 'X좌표'],
  address:     ['역사도로명주소', '소재지도로명주소', '역사지번주소', '소재지지번주소'],
  operator:    ['운영기관명', '제공기관명', '운영기관'],
  baseDate:    ['데이터기준일자', '기준일자'],
});

/**
 * RFC4180 최소 구현. 따옴표 안의 쉼표·줄바꿈·이중따옴표를 처리한다.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * 공공데이터 CSV 는 UTF-8(BOM) 과 CP949 가 섞여 있다. 잘못 읽으면 역명이 통째로 깨져
 * 그룹핑이 전부 어긋나므로 경계에서 확실히 정한다.
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeKoreanText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Node 공식 빌드는 full-icu 라 euc-kr 디코딩을 지원한다.
    return new TextDecoder('euc-kr').decode(buf);
  }
}

/**
 * @param {string[]} header
 * @param {readonly string[]} candidates
 * @returns {number}
 */
function columnIndex(header, candidates) {
  for (const name of candidates) {
    const i = header.findIndex((h) => h.replace(/\s|﻿/g, '') === name);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * @param {string} filePath
 * @returns {Promise<string[][]>}
 */
async function readTable(filePath) {
  if (filePath.toLowerCase().endsWith('.csv')) {
    return parseCsv(decodeKoreanText(await readFile(filePath)));
  }
  if (filePath.toLowerCase().endsWith('.xlsx') || filePath.toLowerCase().endsWith('.xls')) {
    /** @type {XlsxModule|null} */
    let xlsx = null;
    try {
      // 변수 지정자로 import 한다. 리터럴이면 tsc 가 모듈을 해석하려 들어, xlsx 를 설치하지
      // 않은 기본 상태에서 타입 체크가 깨진다. 이 의존성은 선택 사항이다.
      const specifier = 'xlsx';
      const mod = /** @type {{ default?: XlsxModule } & Partial<XlsxModule>} */ (await import(specifier));
      // xlsx 는 CJS 패키지다. Node 의 CJS→ESM 상호운용은 `mod.default` 에 module.exports 전체를
      // 담고, 최상위 named export 는 cjs-module-lexer 의 정적 분석으로 "찾아낸" 일부일 뿐이라
      // 완전하지 않다 — 실측으로 `utils` 는 최상위에 잡히는데 `readFile` 은 빠지는 것을 확인했다
      // (2026-08-25, 양원역 좌표 버그 조사 중 원본 XLSX를 직접 읽어보다 발견). `mod.default`
      // 를 우선 쓰면 이 파편화를 피할 수 있다.
      xlsx = /** @type {XlsxModule} */ (mod.default ?? mod);
    } catch {
      throw new Error(
        `XLSX 를 읽으려면 xlsx 패키지가 필요하다: npm i -D xlsx\n` +
        `  또는 엑셀에서 "CSV UTF-8" 로 저장한 뒤 --file 에 그 경로를 넘겨라 (권장).`,
      );
    }
    const wb = xlsx.readFile(filePath);
    return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  throw new Error(`지원하지 않는 파일 형식: ${filePath} (.csv / .xlsx)`);
}

/**
 * @param {{ filePath: string, log: (msg: string) => void }} opts
 * @returns {import('../types.mjs').StationSource}
 */
export function createStandardFileSource(opts) {
  return {
    id: 'standard-file',
    describe: `전국도시철도역사정보표준데이터 파일 (${opts.filePath})`,

    async fetchRows() {
      const table = await readTable(opts.filePath);
      if (table.length < 2) throw new Error(`파일에 데이터 행이 없다: ${opts.filePath}`);

      const header = table[0].map((h) => h.trim());
      const idx = {
        stationName: columnIndex(header, COLUMNS.stationName),
        lineName:    columnIndex(header, COLUMNS.lineName),
        lineNo:      columnIndex(header, COLUMNS.lineNo),
        stationNo:   columnIndex(header, COLUMNS.stationNo),
        lat:         columnIndex(header, COLUMNS.lat),
        lng:         columnIndex(header, COLUMNS.lng),
        address:     columnIndex(header, COLUMNS.address),
        operator:    columnIndex(header, COLUMNS.operator),
        baseDate:    columnIndex(header, COLUMNS.baseDate),
      };

      // 필수 컬럼이 없으면 뒤에서 조용히 빈 값이 흘러들어가므로 여기서 멈춘다.
      const missing = /** @type {(keyof typeof idx)[]} */ (['stationName', 'lineName', 'lat', 'lng'])
        .filter((k) => idx[k] < 0);
      if (missing.length > 0) {
        throw new Error(
          `표준데이터 필수 컬럼을 찾지 못했다: ${missing.join(', ')}\n` +
          `  파일의 실제 헤더: ${header.join(' | ')}\n` +
          `  → COLUMNS 후보를 갱신하라 (scripts/station-master/sources/standard-file.mjs).`,
        );
      }

      opts.log(`  컬럼 매핑: ${JSON.stringify(Object.fromEntries(
        Object.entries(idx).filter(([, v]) => v >= 0).map(([k, v]) => [k, header[v]]),
      ))}`);

      /** @type {SourceRow[]} */
      const rows = [];
      /** @type {string|null} */
      let sourceUpdatedOn = null;

      for (let r = 1; r < table.length; r += 1) {
        const cells = table[r];
        /** @param {number} i */
        const cell = (i) => (i >= 0 && i < cells.length ? String(cells[i] ?? '').trim() : '');

        const stationName = cell(idx.stationName);
        const lineName = cell(idx.lineName);
        if (stationName === '' || lineName === '') continue;

        const lat = Number.parseFloat(cell(idx.lat));
        const lng = Number.parseFloat(cell(idx.lng));
        const stationNo = cell(idx.stationNo) || null;
        const lineNo = cell(idx.lineNo) || lineName;
        const address = cell(idx.address);

        if (sourceUpdatedOn === null && idx.baseDate >= 0) {
          const d = cell(idx.baseDate).replaceAll('.', '-').replaceAll('/', '-');
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) sourceUpdatedOn = d;
        }

        rows.push({
          // 역번호가 비어 있는 행이 있어 노선+역명 조합을 폴백 키로 쓴다.
          // sourceKey 는 station_merge_overrides.source_keys 가 가리키는 값이기도 하다.
          sourceKey: stationNo ?? `${lineNo}:${stationName}`,
          stationName,
          lineCode: `L-${lineNo}`,
          lineName,
          operator: cell(idx.operator) || null,
          stationNo,
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          regionCode: regionCodeFromAddress(address),
          seqHint: numericPart(stationNo),
        });
      }

      return { rows, sourceUpdatedOn, raw: { file: opts.filePath, rowCount: rows.length } };
    },
  };
}
