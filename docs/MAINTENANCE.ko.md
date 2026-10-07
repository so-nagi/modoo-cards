# 업데이트와 문제 해결

## 업데이트

1. 앱에서 전체 컬렉션을 내보내고 현재 Render 커밋을 기록합니다.
2. Fork의 Sync fork 또는 Git으로 새 소스를 받아 본인 변경과 충돌을 확인합니다. 개인 설정 파일은 덮어쓰지 않습니다.
3. `npm ci`, `npm test`, `npm run build:hosting`과 백엔드 검사를 실행합니다.
4. 서버 API가 추가됐다면 Render의 검증한 커밋을 먼저 배포합니다. `/api/health`가 정상인지 봅니다.
5. `firebase deploy --only hosting --project YOUR_PROJECT_ID`로 화면을 배포합니다.
6. 별도 브라우저 탭에서 로그인·덱 목록·미리보기를 확인합니다. 카드 평가·전체 복원은 단순 점검 용도로 실행하지 않습니다.

서버는 한 프로세스·한 인스턴스로 실행합니다. 여러 워커로 늘리지 않습니다. ETag 충돌 보호가 있어도 여러 서버의 동시 운영을 권장하는 구조는 아닙니다.

## 증상별 확인

| 증상 | 확인할 내용 |
|---|---|
| 첫 접속이 오래 걸림 | Render Free의 기동 대기인지 `/api/health`에서 확인. 계속 새로고침하지 말고 기동 완료 후 다시 접속 |
| Google 로그인 unauthorized-domain | Firebase Authentication 허용 도메인에 현재 Hosting 도메인 등록 |
| Google 로그인 operation-not-allowed | 같은 Firebase 프로젝트의 Google 제공자 활성화 |
| 앱 서버 연결 실패 | `.env.production.local`의 API 주소, 서버 health, 이후 `npm run build:hosting`과 재배포 |
| CORS 오류 / 허용되지 않은 출처 | Render `MODOO_ALLOWED_ORIGINS`에 현재 Hosting의 정확한 HTTPS 출처. 쉼표 주변 공백과 잘못된 프로젝트 ID 확인 |
| 설정 사본 저장 실패 | `(default)` Firestore 생성 여부와 저장소 `firestore.rules` 적용 여부 |
| 저장이 안 됨 / RTDB 권한 거절 | RTDB URL과 로그인 프로젝트가 같은지, 본인 UID 규칙인지, Usage 한도인지 확인 |
| 재시작 후 자료가 사라짐 | `MODOO_DATABASE_URL` 누락 여부. 임시 로컬 파일만 쓰던 서버의 자료를 자동 복원할 수는 없음 |
| APKG 내용 가져오기 오류 | 프런트·서버 버전 일치, health의 `features.contentImport`, 파일 형식·128MB 제한. 원본 보관 후 격리 환경에서 확인 |
| 소리 없음 | 효과음 설정, 음량, 브라우저 탭 음소거. 설정의 음원 직접 재생과 새 탭에서도 확인 |
| 새 화면이 안 보임 | 저장하지 않은 초안을 먼저 보호한 뒤 새 탭 또는 Ctrl+Shift+R |

오류를 공유할 때 비밀번호·ID 토큰·계정 자료·개인 사진·Firebase 사용자 UID가 포함된 로그를 공개 이슈에 붙이지 않습니다. 시간, 브라우저, 버전, 안전하게 재현되는 단계와 오류 종류를 적습니다.

## 삭제와 용량

앱의 덱 삭제·비우기 전에 COLPKG를 보관하세요. 미디어의 이전 해시 조각은 자동으로 회수하지 않습니다. RTDB 콘솔에서 `accounts` 전체를 임의 삭제하면 복습 기록까지 잃을 수 있습니다. 무료 한도에 가까워졌다면 먼저 백업하고 자료를 줄이거나 구조·요금제를 별도로 검토합니다.

## 글꼴 직접 추가

공개본은 Pretendard를 사용합니다. 합정산스 등 다른 글꼴을 쓸 경우 본인의 웹 임베딩·배포 권한을 확인하고 글꼴 파일을 개인 배포에만 추가합니다. `src/styles.css`의 앱 `@font-face`와 기본 font-family, `src/components/cardAppearance.ts`의 `cardFont()` 경로·FontFace 이름·기본 font-family를 함께 변경합니다. 글꼴이 없는 기기에서 카드도 표시되는지 확인합니다. 가져온 카드의 사용자 지정 템플릿 글꼴은 자동으로 바꾸지 않습니다.

## Docker 수동 실행

```bash
docker build --build-arg VITE_SOURCE_URL=https://github.com/YOUR_GITHUB_NAME/modoo-cards-open -t modoo-cards .
docker run --rm --env-file render.env -e PORT=10000 -p 10000:10000 modoo-cards
```

이 예시는 앞서 생성한 본인 `render.env`를 사용합니다. Google 로그인 허용 도메인과 실제 접근 주소가 일치해야 합니다. 공개 서버는 HTTPS 프록시와 정확한 `MODOO_PUBLIC_ORIGIN`이 필요합니다. Render 외의 서버에서도 영구 볼륨 없이 사용할 때는 RTDB 연결을 생략하지 않습니다.
