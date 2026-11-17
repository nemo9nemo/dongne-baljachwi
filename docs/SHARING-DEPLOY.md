# 운영 공유 서버 배포

2026-11-17. 초기 배포 대상으로 Railway를 선택했다. 기존 Node 연결 서버를 컨테이너로 실행하고 영구 볼륨에 승인/해제 상태를 보관한다. 기록·사진은 이 서버에 저장하지 않는다. 실제 계정 연결과 운영 배포·HTTPS 검증은 별도 완료 조건이다.

## 요금과 연결

확인 시점의 Railway Free는 30일/$5 체험 후 매월 $1 사용 크레딧과 0.5GB 볼륨을 제공한다. 지속 운영을 무료로 보장하지 않는다. Hobby는 월 최소 $5이며 포함 사용량을 넘으면 추가 과금된다. 계정을 연결한 뒤 적용 플랜·남은 크레딧·사용 한도를 확인하고 유료 전환은 별도로 결정한다. [공식 요금](https://railway.com/pricing), [비용 제한](https://docs.railway.com/pricing/cost-control).

## 배포 설정

1. 이 저장소의 `develop` 브랜치로 서비스를 생성한다. 루트 `railway.toml`이 공유 서버 Dockerfile과 상태 확인 경로를 지정한다.
2. 서비스에 영구 볼륨을 생성하고 `/data`에 마운트한다. 0.5GB로 시작할 수 있다. 프로세스는 한 개만 실행하고 볼륨 없이 운영하지 않는다. [볼륨 계약](https://docs.railway.com/volumes).
3. `SHARE_ALLOWED_ORIGINS=https://localhost`를 설정한다. 웹 앱을 배포하면 그 HTTPS origin도 쉼표로 추가한다. 와일드카드를 사용하지 않는다.
4. `PORT`는 플랫폼 값을 사용하고 `SHARE_PORT`로 덮어쓰지 않는다. 서버가 `0.0.0.0`에 바인딩하도록 Dockerfile에 설정돼 있다. 플랫폼에서 제공하는 HTTPS 공개 도메인을 연결한다.
5. `/api/device-share/health`가 200인지 확인하고 서비스를 재시작한 뒤 승인 상태와 해제 통지가 유지되는지 검증한다.
6. 앱 설정의 공유 서버 또는 빌드의 `VITE_SHARE_SERVER`에 공개 HTTPS origin을 지정한다. Android 허용 origin은 `https://localhost`다.

직접 WebRTC 연결이 어려운 통신망에는 별도 TURN이 필요할 수 있다. 운영 TURN을 준비하면 서버에만 `SHARE_TURN_URLS`와 `SHARE_TURN_SECRET`을 설정하고 릴레이 비용을 함께 확인한다. 현재 테스트용 TURN을 운영 서비스로 표시하지 않는다.

## 로컬 컨테이너 검증

```sh
node tests/local/container.mjs
```

임시 이미지·컨테이너·볼륨으로 코드 승인, 허용 Origin, 재시작 뒤 연결 상태 보존, 해제 후 재시작과 상대 통지를 확인한다. 2026-11-17 로컬 Docker에서 이 세 시나리오를 통과했고 검증 자원을 정리했다. 컨테이너의 서버 프로세스는 node 사용자로 실행하며 빌드 컨텍스트는 공유 서버 파일만 포함한다. 같은 검사를 GitHub Actions에서도 실행한다.
