# 내 Firebase와 서버로 모두카드 설치하기

확인 기준일: 2026-10-07. 계정 생성과 콘솔 화면 이름은 공급자 변경에 따라 달라질 수 있습니다. 이 안내서는 **본인이 새로 만든 프로젝트**에 설치하는 순서입니다.

## 1. 준비

필요한 계정은 GitHub, Google, Render입니다. PC에 Git, Node.js 22.13 이상, Firebase CLI를 설치합니다. Python은 로컬 실행과 테스트에 필요하며 Render 배포만 한다면 Docker가 설치합니다.

```powershell
node --version
git --version
npm install -g firebase-tools
firebase login
```

명령의 `YOUR_GITHUB_NAME`, `YOUR_PROJECT_ID`는 본인 값으로 바꿉니다. 코드 블록 안의 예시 주소로 실제 배포하지 않습니다. 이 문서에서 Hosting은 정적 **Firebase Hosting**이며 App Hosting이 아닙니다. Cloud Run·Cloud Functions·Cloud Storage는 이 기본 구성에 필요하지 않습니다.

## 2. GitHub 소스 복제

공개 저장소 우측 상단의 **Fork**로 본인 계정에 복사합니다. Fork한 저장소에서 **Code → HTTPS** 주소를 복사하여 실행합니다.

```powershell
git clone https://github.com/YOUR_GITHUB_NAME/modoo-cards.git
cd modoo-cards
npm ci
```

Fork가 불가능한 환경에서는 ZIP을 내려받아 압축을 풀고 본인 저장소에 올릴 수 있습니다. `.gitignore`가 제외하는 파일은 추가하지 않습니다. 원본 소스를 수정하면 본인의 배포 소스도 이용자가 받을 수 있어야 합니다.

## 3. 본인 Firebase 프로젝트 만들기

[Firebase 콘솔](https://console.firebase.google.com/) → 프로젝트 만들기에서 고유한 프로젝트 ID를 정합니다. Firebase 프로젝트는 Google Cloud 프로젝트와 연결됩니다. 별도의 두 프로젝트를 만들 필요가 없습니다.

기본 안내서는 결제 계정을 연결하지 않은 **Spark**를 기준으로 합니다. Analytics는 이 앱에 필요하지 않습니다. 이미 요금제가 있는 다른 업무용 프로젝트 대신 새 개인 프로젝트를 권장합니다.

프로젝트 설정 → 일반 → 내 앱 → 웹 앱(`</>`)을 등록합니다. SDK 설정의 `firebaseConfig` 객체에서 중괄호 안 값을 JSON으로 옮깁니다.

```powershell
Copy-Item firebase.public.example.json firebase.public.json
```

편집기로 `firebase.public.json`을 열어 `apiKey`, `authDomain`, `projectId`, `appId` 등을 콘솔의 실제 값으로 바꿉니다. JSON은 키와 문자열에 큰따옴표를 사용하고 `const firebaseConfig =`와 마지막 세미콜론을 넣지 않습니다.

`apiKey`가 있는 **웹 앱 공개 설정**을 사용합니다. 서비스 계정의 `private_key`, 관리자 키 JSON, Google 비밀번호, 로그인 토큰을 넣지 않습니다. 이 앱은 이용자의 ID 토큰으로 본인 자료에 접근하므로 서비스 계정 비밀키가 필요하지 않습니다.

## 4. Google 로그인 활성화

Build → Authentication → 시작하기 → Sign-in method → Google을 활성화합니다. 지원 이메일을 본인 이메일로 지정합니다.

Authentication → Settings → Authorized domains에서 다음 도메인을 확인합니다. `https://`나 경로를 넣지 않습니다.

- `YOUR_PROJECT_ID.firebaseapp.com`
- `YOUR_PROJECT_ID.web.app`
- 로컬 Google 로그인도 사용할 경우에만 `localhost`, `127.0.0.1`
- Render 주소로 앱을 직접 열 경우 본인의 `YOUR_SERVICE.onrender.com`

기본 `authDomain`은 `YOUR_PROJECT_ID.firebaseapp.com`을 유지합니다. Google Cloud에서 OAuth를 별도로 바꾼 경우 해당 프로젝트의 OAuth 허용 도메인·동의 화면·테스트 사용자 설정도 확인합니다. 앱이 임의로 이를 우회하지 않습니다.

로그인 설정은 자료 접근 권한과 다릅니다. 아래 규칙이 계정별 자료를 분리합니다. **현재 앱은 Google 계정 소유자 누구나 로그인할 수 있습니다. 개인 설치 주소 자체가 비공개 접근 제어를 대신하지는 않습니다.** 소수의 사용자에게 공유하고 사용량을 확인하세요. 여러 사람에게 공개 운영하려면 가입 제한·요청 제한·운영 정책을 추가 검토해야 합니다.

## 5. Realtime Database 만들기

Build → Realtime Database → Create Database를 선택합니다. 가까운 지역을 선택하고 **잠금 모드**로 생성합니다. 데이터베이스 위치는 생성 후 쉽게 바꿀 수 없으므로 이 단계에서 확인합니다.

데이터 탭 위에 표시되는 정확한 URL을 복사합니다. 예:

```text
https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app
```

미국 기본 인스턴스는 `https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com`처럼 다를 수 있습니다. 주소를 추측하지 말고 콘솔에서 복사합니다. `/accounts`, `.json`, `?auth=...`를 붙이지 않습니다. 설치 도구는 같은 프로젝트의 **기본 데이터베이스**를 지원합니다.

Rules 탭에 저장소의 `database.rules.json` 전체를 붙여 넣고 Publish합니다. 최상위 읽기·쓰기는 거절하고 `accounts/{uid}`는 로그인한 본인 UID에만 허용합니다. 테스트 모드의 전체 공개 규칙을 사용하지 않습니다. 기존 자료가 있는 DB의 규칙을 덮어쓰지 마세요.

## 6. 화면 설정용 Firestore 만들기

Build → Firestore Database → Create database에서 Standard / Native 모드의 `(default)` 데이터베이스를 생성합니다. 가까운 지역을 선택하고 프로덕션/잠금 모드로 시작합니다. 추가 요금 기능을 켤 필요가 없습니다.

Rules 탭에 저장소의 `firestore.rules`를 붙여 넣고 Publish합니다. 화면 설정만 본인의 `users/{uid}/settings/ui`에 저장할 수 있습니다. 덱과 복습 기록은 앞에서 만든 **Realtime Database**에 보존됩니다.

이 두 규칙은 나중에 CLI로도 배포할 수 있습니다. 새 프로젝트의 데이터베이스를 생성하지 않은 상태에서 CLI 규칙 배포부터 실행하지 않습니다.

## 7. Render에서 Anki 서버 만들기

[Render 대시보드](https://dashboard.render.com/) → New → Web Service에서 **본인이 Fork한 저장소**를 연결합니다. 다른 운영 저장소를 선택하지 않습니다.

| 항목 | 값 |
|---|---|
| Language/Runtime | Docker |
| Branch | 본인 저장소의 기본 브랜치 |
| Root Directory | 비워 두기 |
| Dockerfile | `./Dockerfile` |
| Region | 본인 DB와 가까운 지역 |
| Instance Type | Free |
| Health Check Path | `/api/health` |
| Auto Deploy | 처음에는 Off 권장 |

Persistent Disk·유료 DB는 추가하지 않습니다. 환경 변수에 아래 값을 넣습니다. Render는 `PORT`와 `RENDER_EXTERNAL_URL`을 제공하므로 직접 만들지 않습니다.

| 환경 변수 | 넣을 값 |
|---|---|
| `MODOO_LOCAL_AUTH` | `0` |
| `MODOO_DATA_DIR` | `/tmp/modoo-cards-cache` |
| `MODOO_FIREBASE_CONFIG` | 3단계의 공개 설정 JSON 전체를 한 줄로 |
| `MODOO_DATABASE_URL` | 5단계에서 복사한 URL |
| `MODOO_ALLOWED_ORIGINS` | `https://YOUR_PROJECT_ID.web.app,https://YOUR_PROJECT_ID.firebaseapp.com` |
| `VITE_SOURCE_URL` | 본인 배포 소스가 있는 공개 GitHub 저장소 URL |
| `TZ` | `Asia/Seoul` 또는 본인 시간대 |

`MODOO_ALLOWED_ORIGINS`의 쉼표 앞뒤에 공백을 넣지 않습니다. `*`로 열지 않습니다. JSON을 한 줄로 만들려면 PC에서 다음 명령을 실행하고 결과를 `MODOO_FIREBASE_CONFIG` 값 칸에 붙여 넣습니다. **공개 웹 설정 파일만** 이 명령에 사용합니다.

```powershell
Get-Content firebase.public.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress
```

생성을 진행해 빌드가 Live가 될 때까지 기다립니다. 서비스 화면의 실제 HTTPS 주소를 복사합니다. `https://YOUR_SERVICE.onrender.com/api/health`를 열었을 때 `ok: true`, `engine: anki`, `features.contentImport: true`가 보여야 합니다.

Blueprint를 쓰려면 저장소의 `render.yaml`을 선택해도 됩니다. `sync: false` 변수는 본인 값으로 모두 입력해야 하며 결제 조건이 달라졌다면 생성 전에 멈추고 확인합니다.

## 8. 내 설정 파일 자동 생성

PC의 저장소 폴더에서 한 줄로 실행합니다. 주소 세 개는 본인 것으로 바꿉니다.

```powershell
npm run setup -- --firebase-config firebase.public.json --database-url https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app --api-origin https://YOUR_SERVICE.onrender.com --source-url https://github.com/YOUR_GITHUB_NAME/modoo-cards-open --force
```

이 명령은 로컬 파일만 만듭니다. 계정·프로젝트·결제·보안 규칙을 생성하거나 바꾸지 않습니다. `--force`는 직접 만든 `firebase.public.json`을 정리된 동일 설정으로 다시 쓰는 옵션입니다. 기존 설치를 갱신하는 경우 파일을 백업한 후 사용합니다.

| 생성 파일 | 용도 |
|---|---|
| `.firebaserc` | Firebase CLI의 본인 프로젝트 ID |
| `firebase.public.json` | 로컬 서버에서 쓰는 공개 SDK 설정 |
| `.env.production.local` | Hosting 빌드의 API·소스 코드 주소 |
| `render.env` | Render에 입력할 환경 변수 모음 |

이 파일들은 Git에서 제외됩니다. `render.env`의 `MODOO_PUBLIC_ORIGIN`을 Render에 추가하면 실제 서버 주소를 명시할 수 있습니다. 다른 값은 7단계와 일치해야 합니다. Render에 환경 변수 파일로 넣을 때에는 JSON 값이 따옴표·줄바꿈 손실 없이 저장됐는지 확인합니다.

## 9. Firebase Hosting 배포

Firebase 콘솔에서 Hosting의 시작 안내를 엽니다. 저장소에는 `firebase.json`이 있으므로 `firebase init`으로 덮어쓰지 않습니다. 특히 React 소스를 Hosting 폴더로 선택하지 않습니다.

```powershell
firebase projects:list
firebase use
npm run build:hosting
firebase deploy --only hosting --project YOUR_PROJECT_ID
```

`firebase use`의 프로젝트가 본인 ID인지 확인합니다. 배포 명령에도 `--project`를 명시합니다. `build:hosting`은 앞 단계의 API 주소로 `dist-hosting`을 생성합니다.

콘솔에 규칙을 직접 넣지 않았다면 **새 프로젝트의 두 데이터베이스가 생성된 후** 다음을 실행합니다.

```powershell
firebase deploy --only database,firestore:rules --project YOUR_PROJECT_ID
```

완료 후 `https://YOUR_PROJECT_ID.web.app`를 엽니다. 서비스 계정 키나 `firebase login:ci` 장기 토큰은 필요하지 않습니다.

## 10. 첫 사용과 저장 확인

1. 본인 Google 계정으로 로그인합니다. 덱이 비어 있는 것은 정상입니다. 원본 운영자의 자료가 자동으로 복사되지 않습니다.
2. 본인 테스트 덱에 카드 한 장을 만들고 새로고침해서 남아 있는지 봅니다.
3. 다른 기기에서 같은 Hosting 주소·같은 Google 계정으로 로그인하여 확인합니다.
4. 테스트 덱을 백업한 후 Render를 재시작하고 다시 열어 자료가 남는지 확인합니다. RTDB 연결 없이 Render 임시 파일에만 저장된 상태를 운영하지 않습니다.
5. 실제 자료는 [가져오기와 백업](USAGE.ko.md)의 구분을 읽고 가져옵니다. 특히 `.colpkg` 복원은 전체 컬렉션을 바꿉니다.

## 무료 범위와 유지 비용

2026-10-07 공식 문서 기준 Render Free 서버는 요청이 없는 시간이 15분이면 쉬고 다음 접속에서 약 1분의 기동 대기가 생길 수 있습니다. 재시작·재배포·절전 시 로컬 파일은 사라집니다. 이 앱의 `MODOO_DATABASE_URL`이 자료 보존에 필수인 이유입니다. 무료 사용량은 계정 전체 한도를 공유합니다. [Render Free](https://render.com/docs/free)

Firebase는 Spark 한도 안에서 사용합니다. 저장 용량·다운로드·동시 연결·일일 작업 한도는 제품별로 다릅니다. 한도 초과 시 기능 제한이 발생할 수 있으므로 각 콘솔의 Usage를 확인합니다. 결제 계정을 연결하거나 Blaze로 바꾸면 별도의 비용 조건이 생깁니다. 이 설치 도구는 요금제를 바꾸지 않습니다. [Firebase 요금](https://firebase.google.com/pricing) · [RTDB 한도](https://firebase.google.com/docs/database/usage/limits)

이 앱은 Anki 컬렉션 스냅샷을 저장하는 방식이라 변경량보다 네트워크 전송량이 클 수 있습니다. 작은 개인 컬렉션용 출발점이며 대규모 공개 서비스용 구성이 아닙니다. 이미지·음원 누적으로 사용량이 커지므로 `.colpkg` 백업과 콘솔 사용량 확인을 병행합니다. 앱 내부 크기 한도는 무료 요금제의 잔여 용량을 보장하지 않습니다.

## 공식 참고 문서

- [Firebase 웹 프로젝트 등록](https://firebase.google.com/docs/web/setup)
- [Google 로그인 설정](https://firebase.google.com/docs/auth/web/google-signin)
- [Realtime Database 시작](https://firebase.google.com/docs/database/web/start)
- [Firestore 시작](https://firebase.google.com/docs/firestore/quickstart)
- [Firebase Hosting 배포](https://firebase.google.com/docs/hosting/quickstart)
- [Render Docker 배포](https://render.com/docs/docker)
