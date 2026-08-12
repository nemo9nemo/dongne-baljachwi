# DB 검증 (마이그레이션 · RLS · 함수)

```bash
npm run test:db                  # 전체
npm run test:db -- couple-link   # 파일명 부분 일치로 골라 실행
```

Docker 도 Supabase CLI 도 필요 없다. 인메모리 Postgres(PGlite)를 띄우고
`supabase/migrations/*.sql` 을 이름순으로 **그대로** 적용한 뒤 테스트 SQL을 돌린다.
마이그레이션 적용이 실패하면 그 자리에서 멈춘다 — 즉 이 명령은 "마이그레이션이 맨
Postgres 에 처음부터 적용되는가"까지 같이 검증한다.

## 파일

| 파일 | 내용 |
|---|---|
| `support/00-supabase-stub.sql` | 플랫폼이 미리 만들어 두는 것들(롤 3종, `auth`, `storage`)만 흉내낸 스텁. **마이그레이션이 아니다** |
| `support/01-test-kit.sql` | 어서션(`test.ok/eq/raises`), 세션 시뮬레이션(`test.as_user`), 픽스처(`test.signup/reset/seed_station`) |
| `10-core-identity.test.sql` | profiles / couples / couple_members / `current_couple_id()` / 컬럼 권한 |
| `20-couple-link.test.sql` | `create_couple` · `issue_invite` · `redeem_invite` · `dissolve_couple` |
| `30-records.test.sql` | records / photos / tags / 집계 뷰 / Storage 격리 |
| `40-local-date.test.sql` | KST(로컬) 날짜 vs UTC(서버) 날짜 회귀 테스트 |
| `50-station-master.test.sql` | `apply_station_master` 멱등성 · 폐역 처리 · `master_version` · 배치 권한 |

## 테스트 작성 규칙

- 실패를 기대하는 문장은 **반드시** `test.raises(...)` 로 감싼다. 그냥 실행하면 파일 전체
  트랜잭션이 어보트되어 그 파일의 결과가 통째로 사라진다.
- 롤 전환(`set role authenticated` / `reset role`)과 `test.as_user()` 는 파일 최상위에서 한다.
- 실행 시각에 따라 결과가 달라지는 어서션을 쓰지 않는다. "KST 새벽"처럼 시간에 얽힌 조건은
  `current_date + 1` 처럼 시각과 무관한 동치 표현으로 바꿔 쓴다 (`40-local-date` 참고).

## 이 하네스로 검증할 수 없는 것

- **Auth 서비스 동작** (이메일 확인, 비밀번호 정책, 재발송 쿨다운). `supabase/config.toml` 소관이며
  실제 프로젝트에서 확인해야 한다.
- **PostgREST 응답 봉투** (에러가 `message` 필드에 어떻게 실리는지). SQL 레이어의 sqlstate/메시지까지만
  검증한다.
- **Storage 서비스** (서명 URL, 업로드 파이프라인). 스텁은 `storage.objects` 행 수준의 RLS 만 재현한다.
