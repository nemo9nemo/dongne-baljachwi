# 👣 동네 발자취

연인이 함께 다녀온 데이트 장소를 지하철 노선도 위에 기록하고, 사진과 일기로 추억을 남기는
**커플 전용** 데이트 아카이브 서비스.

> 기획 원본은 노션 "👣 동네 발자취 — 기획서"이며, 그 내용을 그대로 옮긴 [`docs/PRD.md`](docs/PRD.md)가
> 최종 소스다.

## 기술 스택

| 항목 | 결정 |
|---|---|
| 프레임워크 | Vite + React + TypeScript (SPA) |
| DB / 인증 / 스토리지 | Supabase (Postgres + Auth + Storage), 클라이언트에서 직접 호출 |
| 배포 | Vercel |
| 커플 연결 | 초대 코드 방식 |
| 노선도 (메인 화면) | 직접 그린 SVG + 좌표 데이터 |
| 지도 보기 (보조 토글) | 카카오맵 |
| 역 좌표 데이터 | 전국도시철도역사정보표준데이터 (공공데이터포털 파일데이터) |

수도권 지하철 기준. 모바일 우선 반응형, 데스크톱도 동일하게 지원.

## 시작하기

```bash
npm install
cp .env.example .env.local   # Supabase/카카오맵 키 채우기
npm run dev
```

### 주요 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입체크 + 프로덕션 빌드 |
| `npm run lint` | oxlint |
| `npm run test:db` | Supabase 스키마/RLS/RPC 계약 테스트 (pglite 기반) |
| `npm run stations:load` | 역 마스터 데이터 배치 적재 (`service_role` 키 필요) |
| `npm run verify:line-map` | 노선도 SVG 좌표와 역 마스터 데이터 정합성 검증 |

## 문서

- [`docs/PRD.md`](docs/PRD.md) — 기획 원문, 모든 작업의 출발점
- [`docs/specs/`](docs/specs) — 기능별 상세 스펙
- [`docs/decisions/`](docs/decisions) — 되돌리기 어려운 결정 기록 (ADR)
- `docs/design/` — 와이어프레임, 비주얼 스펙 (아직 없음)

## 협업 구조

작업은 6개 역할로 나뉜다 (`.claude/agents/`): 기획자 · 개발자(프론트) · 개발자(백엔드) ·
디자이너 · QA · API 테스터. 자세한 작업 흐름과 공통 규약은 [`CLAUDE.md`](CLAUDE.md) 참고.

이 프로젝트는 순수 SPA다 — 별도 API 서버 없이 Supabase JS 클라이언트가 RLS로 보호되는
Postgres/RPC를 직접 호출한다.
