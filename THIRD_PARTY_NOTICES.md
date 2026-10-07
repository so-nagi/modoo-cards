# 외부 소스와 자산

애플리케이션 소스: Copyright (C) 2026 Modoo Cards contributors, AGPL-3.0-or-later. 외부 구성 요소에는 아래 개별 라이선스를 적용합니다. 별도 라이선스가 있는 파일을 앱 라이선스로 다시 허가하는 뜻이 아닙니다.

| 구성 요소 | 라이선스·출처 |
|---|---|
| Anki 26.9.3 Python/Rust 코어 | AGPL-3.0-or-later 및 상위 프로젝트에 표시된 개별 구성 요소. [정확한 소스 태그](https://github.com/ankitects/anki/tree/26.09.3), [상위 고지](LICENSES/Anki-NOTICE.txt) |
| Pretendard | SIL Open Font License 1.1, Kil Hyung-jin 및 원본 기여자. [LICENSES/Pretendard-OFL.txt](LICENSES/Pretendard-OFL.txt), [원본](https://github.com/orioncactus/pretendard) |
| Banana Split Lubed by Akira | 제공 패키지의 GPL-3.0 조건. `public/sounds/banana-split-lubed/LICENSE.txt`와 출처 문서, 원본 7개와 파생본을 함께 포함. 변환 코드는 `scripts/generate_banana_sounds.py` |
| Tesseract.js 및 core | Apache-2.0. `public/ocr/tesseract-LICENSE.md`, `core-LICENSE.txt` |
| eng/kor tessdata_fast 모델 | Apache-2.0. [원본](https://github.com/tesseract-ocr/tessdata_fast), `LICENSES/tessdata_fast-LICENSE.txt` |
| React, Vite, Firebase JS SDK, lucide-react 등 | 버전은 package-lock.json, 개별 라이선스는 설치한 패키지에 포함. 각각의 소스와 조건을 유지 |
| FastAPI, Uvicorn, Firebase Admin, zstandard 등 | requirements-runtime.txt에 고정. 각 배포 패키지의 원본 라이선스를 유지 |

React·React DOM은 MIT, lucide는 ISC, Tesseract.js와 Firebase JS SDK는 Apache-2.0입니다. 의존성 전체를 하나의 라이선스로 간주하지 않습니다. 이 저장소는 외부 패키지의 실행 바이너리를 별도로 배포하지 않으며 설치 과정에서 고정된 버전을 받습니다. 직접 Docker 이미지나 수정된 외부 코어를 배포할 때에는 해당 버전의 소스·고지를 함께 제공하세요.

합정산스(HJSS), 원본 Cherry MX 음원, 출처가 확인되지 않은 종이 텍스처, 개인 단어장 사진·학습 자료는 포함하지 않습니다. 공개본에는 클래식 스킨만 포함합니다. 기존 모두투두의 스킨 구조를 참고한 앱 UI이며 제삼자 서비스의 공식 제품이나 Anki 로고를 사용하지 않습니다.
