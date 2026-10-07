import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', 'dist', 'dist-hosting', 'dist-demo', 'artifacts', 'data', 'data-local', '.firebase']);
const generated = new Set(['.firebaserc', 'firebase.public.json', '.env.production.local', 'render.env']);
function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || generated.has(entry.name) || entry.name.endsWith('.log')) return [];
    const path = resolve(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error('배포 파일에 심볼릭 링크가 있습니다.');
    return entry.isDirectory() ? walk(path) : [relative(root, path).split(sep).join('/')];
  });
}
let tracked;
try { tracked = execFileSync('git', ['-c', `safe.directory=${root}`, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); } catch {}
// A source ZIP has no Git database. Include the working source, but check tracked exclusions too.
const files = [...new Set([...walk(root), ...(tracked || [])])];
const findings = [];
const excludedSkin = /(?:skin|preview)-(?:folder|line|monochrome)\b|data-card-skin=(?:folder|line|monochrome)\b|updateWordBlush|modoo-blush-/;
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAIza[A-Za-z0-9_-]{30,}|\bya29\.[A-Za-z0-9_-]{30,}/;
const privatePath = /(?:^|\/)(?:data(?:-local)?|logs|\.firebase|\.release|node_modules|\.venv)(?:\/|$)|\.(?:anki2|apkg|colpkg|sqlite3?|db|log)$/i;
for (const name of files) {
  if (generated.has(name) || privatePath.test(name) || /(?:service.account|credential|token-cache)/i.test(name)) { findings.push(`${name}: private/generated path`); continue; }
  const path = resolve(root, name);
  if (lstatSync(path).isSymbolicLink()) { findings.push(`${name}: symbolic link`); continue; }
  if (!/\.(?:ts|tsx|js|mjs|py|md|txt|json|ya?ml|css|html)$/.test(name) && !['Dockerfile', '.gitignore', '.dockerignore'].includes(name)) continue;
  const text = readFileSync(path, 'utf8');
  if (name.startsWith('src/') && excludedSkin.test(text)) findings.push(`${name}: excluded skin rendering code`);
  if (secret.test(text)) findings.push(`${name}: possible credential pattern (value withheld)`);
  if (/C:[\\/]Users[\\/]|mxgin|mx\.gin\.xo|modoo-cards-20261004/i.test(text) && name !== 'scripts/check-public-release.mjs') findings.push(`${name}: original installation identifier`);
}
for (const name of ['LICENSE','THIRD_PARTY_NOTICES.md','LICENSES/Pretendard-OFL.txt','LICENSES/Anki-NOTICE.txt','LICENSES/tessdata_fast-LICENSE.txt','public/fonts/LICENSE.txt','public/ocr/tessdata_fast-LICENSE.txt','public/sounds/banana-split-lubed/LICENSE.txt','docs/SELF_HOSTING.ko.md','docs/RELEASE_CHECK.md']) {
  if (!files.includes(name)) findings.push(`${name}: missing notice or guide`);
}
if (files.includes('public/fonts/hjss.ttf') || files.some(name => name.startsWith('public/sounds/cherrymx-') || name.startsWith('public/textures/'))) findings.push('Excluded assets are present');
// Check stale build chunks too: omitting them from index.html is not sufficient.
for (const folder of ['dist', 'dist-hosting', 'dist-demo']) {
  const path = resolve(root, folder);
  if (!existsSync(path)) continue;
  for (const name of walk(path)) {
    if (/\.(?:js|css)$/.test(name) && excludedSkin.test(readFileSync(resolve(root, name), 'utf8'))) findings.push(`${name}: excluded skin remains in build output`);
  }
}
if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${files.length} public source files; no matched credentials, personal deployment IDs or private data paths. This is a scoped release check, not a full security audit.`);
