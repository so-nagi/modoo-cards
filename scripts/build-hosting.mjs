import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { httpsOrigin } from './setup-self-host.mjs';

try {
  const raw = readFileSync('.env.production.local', 'utf8');
  const api = raw.match(/^VITE_API_ORIGIN=(.+)$/m)?.[1].trim();
  const source = raw.match(/^VITE_SOURCE_URL=(.+)$/m)?.[1].trim();
  httpsOrigin(api, 'API 서버');
  if (!source?.startsWith('https://github.com/')) throw new Error('공개 소스 저장소 URL이 필요합니다.');
  if (!process.env.npm_execpath) throw new Error('npm run build:hosting으로 실행하세요.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '--', '--outDir', 'dist-hosting'], {
    stdio: 'inherit', env: { ...process.env, VITE_API_ORIGIN: api, VITE_SOURCE_URL: source },
  });
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) {
    const check = spawnSync(process.execPath, ['scripts/check-public-release.mjs'], { stdio: 'inherit' });
    process.exitCode = check.status ?? 1;
  }
} catch (error) {
  console.error('Hosting 빌드 전에 npm run setup을 완료하세요. ' + error.message);
  process.exitCode = 1;
}
