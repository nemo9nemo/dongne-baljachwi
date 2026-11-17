# Android 빌드와 서명

Android 빌드에는 JDK 21, Android SDK Platform 36, Build Tools 36.0.0과 platform-tools를 사용한다. `JAVA_HOME`과 `ANDROID_HOME`을 해당 설치 경로로 설정한다. 앱 ID는 `com.nemo9.dongnebaljachwi`, 현재 버전은 versionCode 1 / versionName 1.0이다.

```sh
npm ci
npm run android:apk
npm run android:release
```

두 명령 모두 실제 기기 저장 앱을 웹 빌드하고 Capacitor 플러그인을 동기화한 뒤 Gradle을 실행한다. `output/android/`에 디버그 APK 또는 업로드 키로 서명한 출시 APK·AAB와 SHA-256 목록을 만든다. 이 폴더와 키 파일은 Git에서 제외한다. 디버그 앱과 출시 앱은 서명이 다르므로 서로 덮어 설치할 수 없다. 전환 전에 앱의 암호화 백업을 기기 밖에 보관한다.

## 출시 키

2026-11-17에 디버그 APK·출시 서명 APK·AAB를 실제 빌드했다. 출시 APK의 앱 ID·minSdk 24·targetSdk 36과 RSA 4096비트 업로드 서명을 확인했다. 디버그/출시 APK 모두 ZIP 16KB 정렬 검사와 arm64-v8a·x86_64 SQLCipher ELF의 PT_LOAD 16KB 정렬 검사를 통과했다. AAB도 `jarsigner -verify`로 서명을 확인했다. 이는 에뮬레이터/실기기 실행 결과와 별개다. [Android CI](https://github.com/nemo9nemo/dongne-baljachwi/actions/runs/44099047861), [전체 앱 CI](https://github.com/nemo9nemo/dongne-baljachwi/actions/runs/44099047630).

키와 암호는 저장소·PR·로그에 넣지 않는다. 기본 로컬 설정은 사용자 홈의 `.config/dongne-baljachwi/android-signing/signing.json`이다. 다른 위치를 쓰면 `BALJACHWI_ANDROID_SIGNING_FILE`로 지정한다. 설정 파일에는 `storeFile`(키 파일의 절대 경로), `storePassword`, `keyAlias`, `keyPassword`를 넣고 현재 사용자만 읽을 수 있게 보관한다.

CI에서 사용할 때는 다음 환경 변수 네 개를 비밀 값으로 전달한다. 환경 변수는 로컬 설정 파일보다 우선한다.

- `BALJACHWI_ANDROID_KEYSTORE_PATH`
- `BALJACHWI_ANDROID_KEYSTORE_PASSWORD`
- `BALJACHWI_ANDROID_KEY_ALIAS`
- `BALJACHWI_ANDROID_KEY_PASSWORD`

키가 준비되지 않으면 출시 빌드는 실패하며 디버그 키로 대신 서명하지 않는다. 새 앱의 업로드 키는 RSA 4096비트 / PKCS12로 생성한다. 키 파일·암호·공개 업로드 인증서는 별도 안전한 위치에 백업하고, Play App Signing 등록 시 업로드 인증서를 사용한다. 스토어가 배포 앱을 서명하는 키와 업로드 키는 구별한다. [Android 앱 서명 안내](https://developer.android.com/studio/publish/app-signing).

## 공유 서버와 실기기 점검

운영 공유 서버 배포 전에는 APK에서 개인 기록·사진·백업을 먼저 검증한다. `VITE_SHARE_SERVER`에 공개 HTTPS origin을 지정해 빌드하거나 앱 설정에서 서버를 지정한다. 서버의 `SHARE_ALLOWED_ORIGINS`에는 Android origin인 `https://localhost`를 허용한다.

휴대폰 한 대로는 기록·사진 저장, 강제 종료/재실행, 같은 서명의 업데이트, 사진 선택 취소, 암호화 백업 내보내기와 새 맵 복원을 확인할 수 있다. 업데이트 전에 백업하고 앱을 삭제하지 않는다. 서로 다른 두 휴대폰·통신망에서의 코드 승인·전송 중단·재연결·연결 해제 후 독립 수정 검증은 별도로 남는다.

APK/AAB 빌드 성공은 설치·실기기 검증·스토어 심사 통과를 뜻하지 않는다. 최종 아이콘·시작 화면·개인정보/지원 안내·광고·스토어 제출 자료와 네이티브 16KB 페이지 호환성도 별도 점검한다.
