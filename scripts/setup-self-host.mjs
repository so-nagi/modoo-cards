import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const keys = new Set(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL']);
export function httpsOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}: HTTPS 주소를 확인하세요.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || /[\s"'`]/u.test(value)) {
    throw new Error(`${label}: 경로·인증정보·쿼리 없는 HTTPS 주소만 사용하세요.`);
  }
  return url.origin;
}
export function setupFiles(config, databaseUrl, apiOrigin, sourceUrl) {
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(key => !keys.has(key))) {
    throw new Error('Firebase 웹 앱의 공개 SDK 설정 JSON만 입력하세요. 서비스 계정 키는 사용할 수 없습니다.');
  }
  for (const key of ['apiKey', 'projectId', 'authDomain', 'appId']) {
    if (typeof config[key] !== 'string' || !config[key].trim() || /[\r\n]/.test(config[key])) throw new Error(`Firebase ${key}를 확인하세요.`);
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) || config.projectId.startsWith('your-')) throw new Error('실제 Firebase 프로젝트 ID를 입력하세요.');
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`) throw new Error('기본 authDomain은 PROJECT_ID.firebaseapp.com이어야 합니다.');
  for (const [key, value] of Object.entries(config)) if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`${key}는 한 줄 문자열이어야 합니다.`);
  const database = httpsOrigin(databaseUrl, 'Realtime Database');
  const host = new URL(database).hostname;
  if (!/^[a-z0-9-]+\.(?:firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)$/.test(host)) throw new Error('Firebase 콘솔의 Realtime Database URL을 입력하세요.');
  // The guide uses the default database in the same project. Do not connect two projects accidentally.
  if (!host.startsWith(config.projectId + '-default-rtdb.') && !host.startsWith(config.projectId + '.')) throw new Error('Realtime Database와 Firebase 프로젝트 ID가 다릅니다.');
  const api = httpsOrigin(apiOrigin, 'API 서버');
  let source;
  try { source = new URL(sourceUrl); } catch { throw new Error('공개 소스 저장소 URL을 입력하세요.'); }
  if (source.protocol !== 'https:' || source.hostname !== 'github.com' || source.username || source.password || source.search || source.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(source.pathname)) throw new Error('본인 GitHub 저장소의 HTTPS 주소를 입력하세요.');
  const publicConfig = Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'databaseURL'));
  const render = {
    MODOO_LOCAL_AUTH: '0',
    MODOO_DATA_DIR: '/tmp/modoo-cards-cache',
    MODOO_DATABASE_URL: database,
    MODOO_FIREBASE_CONFIG: JSON.stringify(publicConfig),
    MODOO_ALLOWED_ORIGINS: `https://${config.projectId}.web.app,https://${config.projectId}.firebaseapp.com`,
    MODOO_PUBLIC_ORIGIN: api,
    VITE_SOURCE_URL: source.href.replace(/\/$/, ''),
    TZ: 'Asia/Seoul',
  };
  return {
    'firebase.public.json': JSON.stringify(publicConfig, null, 2) + '\n',
    '.firebaserc': JSON.stringify({ projects: { default: config.projectId } }, null, 2) + '\n',
    '.env.production.local': `VITE_API_ORIGIN=${api}\nVITE_SOURCE_URL=${render.VITE_SOURCE_URL}\n`,
    'render.env': Object.entries(render).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
  };
}
export function writeSetup(directory, files, force = false) {
  for (const [name, value] of Object.entries(files)) {
    const path = resolve(directory, name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== value && !force) throw new Error(`${name}이 이미 있습니다. 내용을 확인한 뒤 --force로 갱신하세요.`);
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(resolve(directory, name), value, { mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), values = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === '--force') { values.force = true; continue; }
      if (!['--firebase-config', '--database-url', '--api-origin', '--source-url'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('명령어 옵션을 확인하세요. docs/SELF_HOSTING.ko.md를 참고하세요.');
      values[key] = args[++index];
    }
    if (!values['--firebase-config']) throw new Error('--firebase-config로 공개 SDK 설정 JSON 파일을 지정하세요.');
    const config = JSON.parse(readFileSync(resolve(values['--firebase-config']), 'utf8').replace(/^\uFEFF/, ''));
    writeSetup(process.cwd(), setupFiles(config, values['--database-url'], values['--api-origin'], values['--source-url']), values.force);
    console.log('설정 파일 4개를 만들었습니다. 계정 생성·배포·보안 규칙 변경은 실행하지 않았습니다.');
    console.log('다음: docs/SELF_HOSTING.ko.md의 Render 환경 변수와 Firebase 배포 단계를 진행하세요.');
  } catch (error) { console.error(error instanceof SyntaxError ? 'SDK 설정을 올바른 JSON으로 저장하세요.' : error.message); process.exitCode = 1; }
}
