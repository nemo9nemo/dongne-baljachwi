---
name: pull-request-review
description: 이 저장소에서 GitHub PR을 작성하거나 코드 리뷰할 때 범위 설정, 검토 순서, 피드백 및 병합 준비를 안내한다.
metadata:
  short-description: PR 작성 및 코드 리뷰
---

# PR 작성 및 코드 리뷰

PR 생성, 기존 PR 수정, 리뷰, 피드백 반영, 병합 준비 작업에 사용한다. 브랜치 이름과 기준 브랜치 규칙은 [branch-workflow](../branch-workflow/SKILL.md)를 따른다.

## 기존 PR 이어서 수정

1. **기존 PR부터 찾는다.** 현재 작업 브랜치에 연결된 PR이 있는지 확인한다. 있으면 새 PR을 만들지 않고 해당 PR의 head 브랜치에서 이어서 작업한다. 여러 PR이 연결되어 있거나 대상 PR을 특정할 수 없으면 URL 또는 번호를 확인한다.
2. **base와 head를 확인한다.** 일반 작업 PR은 `base=develop`, `head=<작업 브랜치>`여야 한다. `develop`에서 `master`로 보내는 큰 기능 묶음의 승격 PR만 예외다. base가 잘못됐다면 기존 PR의 base를 `develop`으로 변경하고 새 PR을 중복 생성하지 않는다.
3. **base 변경 후 diff와 리뷰 상태를 다시 확인한다.** GitHub에서 base를 바꾸면 PR의 커밋 목록이나 변경 파일이 달라질 수 있고, 일부 기존 리뷰 댓글이 더는 현재 diff에 적용되지 않을 수 있다. 변경 후 전체 diff, 댓글의 유효성, 승인 상태, CI 결과를 재확인한다. base 변경만으로 기존 리뷰가 여전히 유효하다고 가정하지 않는다.
4. **수정 요청을 실제 코드에 반영한다.** 사용자가 기존 PR의 수정이나 리뷰 피드백 반영을 요청하면, 필요한 변경을 같은 head 브랜치에 적용하고 같은 PR을 갱신한다. 기존 작업 트리의 무관한 수정은 보존하고 PR에 섞지 않는다. 사용자가 리뷰만 요청했다면 코드 수정 없이 발견 사항을 보고한다.
5. **갱신된 PR을 다시 검토한다.** 수정 diff를 `develop` 기준으로 확인하고 PR 본문의 변경·검증 내역을 최신 상태로 맞춘다. 실제로 실행하지 않은 검증을 통과했다고 쓰지 않는다. 새 커밋 이후 승인 무효화 여부와 CI를 확인하고, 필요한 경우 재리뷰를 요청한다.

## PR 작성 절차

1. **대상과 범위를 확인한다.** 현재 브랜치가 의도한 작업 브랜치인지, 비교 대상이 `develop`인지 확인한다. `develop`에서 변경한 경우만 큰 기능 단위로 `master` 반영 PR을 연다. PR의 변경 파일과 커밋을 훑고, 기존 작업 트리에서 비롯된 무관한 변경이 섞이지 않았는지 확인한다.
2. **리뷰 가능한 변경으로 정리한다.** PR 하나는 하나의 목적을 설명할 수 있는 자기 완결된 변경으로 유지한다. 서로 독립된 기능, 대규모 포맷 변경, 대규모 리팩터링은 가능한 한 분리한다. 분리가 의미 있는 순서를 요구하면 의존 관계를 PR 본문에 밝힌다.
3. **제목과 본문에 맥락을 남긴다.** 제목은 변경 결과를 구체적으로 요약한다. 본문에는 왜 필요한지, 무엇을 바꿨는지, 검증 결과와 영향·위험을 적는다. 연관 이슈나 스펙이 있으면 링크한다. UI 변경은 화면 캡처나 확인 방법을 추가하고, DB·RPC·인증 변경은 스키마·권한·데이터 영향과 배포 순서를 설명한다.
4. **초안 또는 리뷰 준비 상태를 선택한다.** 구현·설명·필수 검증이 미완성이면 Draft로 만든다. 리뷰어가 판단할 만큼 준비되면 Ready for review로 전환하고, 실제 담당자가 정해져 있을 때 리뷰를 요청한다.
5. **PR의 base/head와 diff를 다시 확인한다.** base는 `develop`, head는 작업 브랜치여야 한다. `develop`에서 `master`로 보내는 큰 기능 승격 PR은 예외다. 원격에 올라간 커밋이 의도한 변경과 일치하는지 GitHub 비교 화면에서 확인한다.

저장소에 별도 PR 템플릿이 없으므로, 다음 구조를 기본으로 사용한다. 빈 항목은 지우거나 해당 없음으로 표시한다.

```markdown
## 목적
이 변경이 필요한 이유와 해결하는 문제

## 변경 내용
- 핵심 변경 1
- 핵심 변경 2

## 검증
- 실제 수행한 확인과 결과
- 실행하지 않은 검증이 있으면 그 사실과 이유

## 영향 및 주의 사항
- 사용자 영향, 데이터/스키마 변경, 배포 순서, 알려진 제한

## 리뷰 포인트
- 집중해서 봐야 할 파일이나 결정
```

## 리뷰 절차

1. **의도를 먼저 파악한다.** PR 제목·본문, 연결된 이슈와 `docs/PRD.md` 및 관련 `docs/specs/`를 읽고 기대 동작과 범위를 확인한다. 프론트와 백엔드 계약이 걸리면 스펙의 데이터 모델을 함께 본다.
2. **base 기준 전체 diff를 검토한다.** 커밋과 파일을 하나씩 살펴보고, 변경 부분의 주변 코드와 호출 경로를 확인한다. 자동 생성 파일은 원본 입력이나 생성 절차도 확인한다. 아직 보지 않은 파일을 검토 완료로 표시하지 않는다.
3. **문제와 회귀를 우선 찾는다.** 다음을 변경에 맞게 확인한다.
   - 기능이 요구사항을 만족하는지, 경계 조건과 실패 경로가 안전한지
   - 설계가 기존 구조와 데이터 계약에 맞고, 불필요한 복잡성이나 추측성 범위가 없는지
   - 변경된 로직을 검증할 적절한 테스트가 포함되어 있는지, 기존 테스트와 CI 결과가 현재 커밋 기준으로 유효한지
   - 사용자 동작·모바일/데스크톱 UI·문서·배포 절차에 누락이 없는지
   - Supabase 변경이면 RLS, 인증 경계, RPC 계약, 스키마 마이그레이션을 확인하고 `service_role` 키가 브라우저 코드에 노출되지 않는지
   - 비밀 값, 불필요한 데이터, 접근 제어 우회, 의존성·워크플로 변경 등 보안 영향을 확인한다
4. **피드백은 수정 가능한 형태로 쓴다.** 발견 사항은 심각도 순으로 제시하고, 파일·줄 위치, 발생 조건, 사용자나 데이터에 미치는 영향, 필요한 조치를 구체적으로 설명한다. 불확실한 우려는 단정하지 말고 질문으로 확인한다. 필수 수정과 비차단 제안·취향성 지적을 구분한다. 개인 스타일 선호만으로 병합을 막지 않는다.
5. **전체 검토 후 리뷰를 제출한다.** GitHub의 `Comment`는 의견만 남기고, `Request changes`는 수정이 필요한 판단이며, `Approve`는 검토한 변경을 병합할 수 있다는 판단이다. 차단할 문제가 없고 최신 변경까지 읽은 경우에만 승인한다. PR 작성자는 자신의 변경에 독립 리뷰 승인을 남기지 않는다.

GitHub의 `Request changes`가 기술적으로 병합을 막는지는 보호 규칙에 달려 있다. 리뷰 상태만으로 차단된다고 가정하지 말고 병합 상자와 저장소 규칙을 확인한다. 이 저장소의 흐름에서는 차단 의견이 해결되기 전에 리뷰 완료로 처리하지 않는다.

코드 리뷰를 요청받았더라도 로컬 테스트를 임의로 추가하거나 실행하지 않는다. CI 상태와 이미 제공된 검증 결과를 확인하고, 실제 확인하지 않은 동작이나 테스트를 통과했다고 보고하지 않는다.

## 피드백 반영과 병합 준비

- 작성자는 각 의견에 수정, 설명, 또는 기술적 근거가 있는 대안을 답한다. 리뷰어는 새 커밋이 올라오면 변경된 부분과 그에 영향을 받는 경로를 다시 읽는다.
- 새 커밋이 기존 승인을 무효화했는지와 요구된 최신 커밋 승인이 있는지 확인한다. GitHub 설정에 따라 새 코드가 올라온 뒤 이전 승인이 오래된 승인으로 처리될 수 있다.
- 병합 전 PR이 올바른 base를 향하는지, 리뷰가 완료됐는지, 필수 상태 확인이 통과했는지, 충돌이 없는지, 차단 중인 대화가 해결됐는지 확인한다. 필요한 승인·상태 확인은 저장소의 보호 규칙과 GitHub 병합 상자에 표시된 조건을 따른다.
- 저장소에서 허용한 병합 방식을 사용한다. 이 저장소에 정해진 방식이 보이지 않으면 임의로 설정을 바꾸지 않는다. 병합 후 작업 브랜치 삭제는 [branch-workflow](../branch-workflow/SKILL.md)에 따른다.

## 완료 보고

PR URL, `head → base`, 변경 목적, 확인한 CI·검증 결과, 리뷰 판단과 미해결 차단 사항, 병합·브랜치 정리 상태를 간결하게 보고한다. PR이나 리뷰를 실제로 생성·제출하지 않았다면 완료한 것처럼 표현하지 않는다.

## 참고 자료

- [GitHub: Creating a pull request](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request)
- [GitHub: Changing the base branch of a pull request](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-base-branch-of-a-pull-request)
- [GitHub: Reviewing proposed changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [GitHub: Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub: Pull request merge methods](https://docs.github.com/en/pull-requests/reference/pull-request-merges)
- [Google Engineering Practices: Writing good change descriptions](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
- [Google Engineering Practices: Small changes](https://google.github.io/eng-practices/review/developer/small-cls.html)
- [Google Engineering Practices: What to look for in a review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
- [Google Engineering Practices: Code review standard](https://google.github.io/eng-practices/review/reviewer/standard.html)
