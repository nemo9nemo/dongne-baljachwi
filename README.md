# 👣 동네 발자취

다녀온 장소를 지하철 노선도에 기록하고 사진과 일기로 추억을 남기는 개인 기록 서비스.
기본 앱은 로그인 없이 기기에 저장한다. 코드로 연결한 상대에게 맵을 공유하고,
연결을 끊으면 받은 기록과 사진은 각자의 독립 개인 맵으로 남는다.

> 기획 원본은 노션 "👣 동네 발자취 — 기획서"이며, 그 내용을 그대로 옮긴 [`docs/PRD.md`](docs/PRD.md)가
> 최초 기획 원문이다. 현재 계약은 [기기 공유·개인 맵 전환](docs/specs/17-device-sharing-and-personal-fork.md), 구현/검증/남은 작업은 [10월 20일 구현 결과](docs/IMPLEMENTATION-2026-10-20.md)를 따른다.

## 기술 스택

| 항목 | 결정 |
|---|---|
| 프레임워크 | Vite + React + TypeScript (SPA) |
| 기기 저장 | Android: SQLite + 앱 전용 사진 파일 / 브라우저: IndexedDB |
| 공유 | 1:1 코드·승인·WebRTC, 별도 소규모 연결 서버 |
| 네이티브 | Capacitor 8 Android 프로젝트. SDK/JDK 준비와 실기기 검증 필요 |
| 배포 | 웹 정적 파일 + HTTPS 연결 서버. 필요한 경우 TURN 추가 |
| 백업 | 암호화한 글·사진 전체 백업 파일, 기존 맵을 덮어쓰지 않는 복원 |
| 노선도 (메인 화면) | 직접 그린 SVG + 좌표 데이터 |
| 기존 서버 앱 | `VITE_STORAGE_BACKEND=supabase`로 보존. 원격 데이터 자동 이전/삭제 없음 |
| 역 좌표 데이터 | 전국도시철도역사정보표준데이터 (공공데이터포털 파일데이터) |

수도권 지하철 기준. 모바일 우선 반응형, 데스크톱도 동일하게 지원.

## 시작하기

현재 구현·검증·운영 연결 상태는 [진행 현황](docs/PROGRESS.md)을 따른다. 디자인 목업은 개발 서버의 `/design/mockup.html`에서 열 수 있다.

```bash
npm install
npm run dev
```

### 주요 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입체크 + 프로덕션 빌드 |
| `npm run lint` | oxlint |
| `npm run test:db` | Supabase 스키마/RLS/RPC 계약 테스트 (pglite 기반) |
| `npm run test:local` | 실제 앱 저장·암호화 백업·두 브라우저 WebRTC 공유·개인 맵 전환 |
| `npm run test:sharing` | 연결 서버 코드·권한·만료·중계 자격 증명 검증 |
| `npm run share:server` | 운영용 독립 연결 서버 (기본 127.0.0.1:8787) |
| `npm run android:sync` | 웹 빌드 후 Android 자산/플러그인 동기화 |
| `npm run stations:load` | 역 마스터 데이터 배치 적재 (`service_role` 키 필요) |
| `npm run verify:line-map` | 노선도 SVG 좌표와 역 마스터 데이터 정합성 검증 |

## 문서

- [`docs/PRD.md`](docs/PRD.md) — 기획 원문, 모든 작업의 출발점
- [`docs/specs/`](docs/specs) — 기능별 상세 스펙
- [`docs/decisions/`](docs/decisions) — 되돌리기 어려운 결정 기록 (ADR)
- `docs/design/` — 디자인 검토·비주얼 스펙·목업 캡처

## 협업 구조

작업은 6개 역할로 나뉜다 (`.claude/agents/`): 기획자 · 개발자(프론트) · 개발자(백엔드) ·
디자이너 · QA · API 테스터. 자세한 작업 흐름과 공통 규약은 [`CLAUDE.md`](CLAUDE.md) 참고.

개발 서버의 `/`가 실제 기기 저장 앱이며 `/design/mockup.html`은 샘플 디자인 목업이다.
개발에서는 Vite에 연결 API가 포함된다. 두 브라우저 프로필/시크릿 창으로 코드 연결을 확인할 수 있다.

배포와 Android에서는 `VITE_SHARE_SERVER`에 HTTPS 연결 서버 주소를 설정한다.
연결 서버에는 `SHARE_ALLOWED_ORIGINS`, 영구 `SHARE_STATE_PATH`, 필요한 경우 `SHARE_TURN_URLS`·`SHARE_TURN_SECRET`을 설정한다.
자세한 실행·운영·검증 범위는 [구현 결과](docs/IMPLEMENTATION-2026-10-20.md)를 참고한다.

기존 Supabase 서버 앱은 `.env.local`의 `VITE_STORAGE_BACKEND=supabase`와 기존 키를 설정하면 사용할 수 있다.
새 모드로 바꿔도 기존 원격 기록/계정은 삭제되지 않는다. 운영 데이터 이전은 실제 프로젝트 연결과 대조 후 별도로 진행한다.
