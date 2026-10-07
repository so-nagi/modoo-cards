# 모두카드 · 직접 설치하는 학습 카드 웹앱

각 사용자가 소스를 복제하고 **본인의 Firebase 프로젝트와 서버**에 설치합니다. 운영자의 덱, 로그인 계정, Firebase 설정은 포함하지 않습니다.

공식 Anki 26.9.3 엔진으로 카드를 만들고 복습합니다. Anki 프로젝트가 제공하거나 보증하는 서비스는 아니며 AnkiWeb 계정 동기화와 Python/Qt 애드온 실행은 지원하지 않습니다.

## 시작하기

- **웹으로 배포:** [Firebase + Render 설치 안내](docs/SELF_HOSTING.ko.md)
- **PC에서 먼저 실행:** 아래 로컬 실행
- [카드 작성·가져오기·백업 안내](docs/USAGE.ko.md)
- [업데이트·문제 해결](docs/MAINTENANCE.ko.md)
- [개인정보와 운영 범위](docs/PRIVACY.ko.md)
- [라이선스·외부 자산](THIRD_PARTY_NOTICES.md)

## 구성

| 구성 요소 | 역할 |
|---|---|
| Firebase Hosting | React 화면 배포 |
| Firebase Authentication | 본인 프로젝트의 Google 로그인 |
| Firebase Realtime Database | 계정별 Anki 컬렉션·미디어·설정 보존 |
| Cloud Firestore | 화면 설정 사본 |
| Render Docker 서비스 | Python + 공식 Anki 엔진 실행 |

GitHub Pages·Firebase Hosting·Netlify에 정적 파일만 올려서는 Anki 엔진이 실행되지 않습니다. 기본 안내서는 Firebase Spark와 Render Free를 사용합니다. 무료 한도, 첫 접속 대기, 대용량 자료 제한이 있으며 무제한 무료 서비스가 아닙니다. [Render 조건](https://render.com/docs/free) · [Firebase 요금](https://firebase.google.com/pricing)

## 로컬 실행

Node.js 22.13 이상, Python 3.12, Git이 필요합니다. 아래 명령은 저장소 루트에서 실행합니다.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
npm run build
.\start.ps1 -Local -Port 4192
```

`http://127.0.0.1:4192`를 엽니다. 이 모드는 Google 로그인 없이 이 PC에서만 쓰는 별도 `data-local` 컬렉션입니다. 클라우드 계정과 자동으로 병합되지 않습니다. PowerShell 실행 정책이 스크립트를 막으면 아래처럼 서버를 직접 실행합니다.

```powershell
$env:MODOO_LOCAL_AUTH='1'
$env:MODOO_DATA_DIR=(Join-Path $PWD 'data-local')
.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 4192
```

macOS/Linux:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build
MODOO_LOCAL_AUTH=1 MODOO_DATA_DIR="$PWD/data-local" .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 4192
```

로컬 모드를 인터넷에 공개하지 않습니다. 공개 실행 진입점은 `python -m server.serve`이며 Google 설정이 없으면 시작하지 않습니다.

## 주요 기능

- 덱·하위 덱·중요 표시·검색·목록/갤러리 보기
- Basic, 역방향, 입력형, Cloze, 사각형 이미지 가리기
- 사진 한영 OCR와 확인 후 단어 등록, TSV/CSV 가져오기
- APKG 내용 가져오기, 전체 컬렉션 COLPKG 복원과 내보내기
- Anki 복습 일정, 네 등급 평가, 되돌리기, 통계
- 클래식 스킨, 라이트·내추럴·다크 테마, 포인트색, 카드 글자 크기
- 효과음 켜기·끄기, 브라우저 음성 읽기

공개본에는 **클래식 스킨만** 포함합니다. 다른 스킨의 선택 메뉴·CSS·카드 렌더링 코드는 포함하지 않습니다. 기본 폰트는 **Pretendard**입니다. 합정산스와 출처별 재배포 허가가 없는 종이 이미지·기존 Cherry 음원은 포함하지 않습니다. 카드의 HTML 데이터 구조는 그대로 유지합니다.

## 개발·검증

```powershell
npm test
npm run build
npm run check:release
.venv\Scripts\python.exe -m pytest tests/backend -q
node --experimental-strip-types tests/features/sound-integrity.mjs
```

원본 스케줄러를 프런트엔드에서 대체하지 않습니다. 사용자 카드로 테스트용 가져오기·삭제·평가를 수행하지 않습니다. 자세한 검증 범위는 [RELEASE_CHECK.md](docs/RELEASE_CHECK.md)에 기록합니다.

## 라이선스

애플리케이션 코드는 **AGPL-3.0-or-later**입니다. [LICENSE](LICENSE)를 확인하세요. 수정하여 웹 서비스를 운영하는 경우 이용자가 해당 버전 소스를 받을 수 있도록 저장소를 공개하고 `VITE_SOURCE_URL`을 설정하세요. 외부 폰트·음원·OCR 파일에는 각각의 라이선스가 적용됩니다.

이 공개본은 2026-10-07 운영 코드 기준으로 분리한 새 소스 이력입니다. 개인 계정 자료·기존 비공개 저장소 이력은 포함하지 않습니다.
