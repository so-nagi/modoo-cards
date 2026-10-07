import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve('dist-demo');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const base=process.env.DEMO_BASE_PATH || '/modoo-cards/';
assert.ok(html.includes(`${base}assets/`),'Demo assets must use the configured Pages prefix');
const scripts=readdirSync(resolve(root,'assets')).filter(file=>file.endsWith('.js')).map(file=>readFileSync(resolve(root,'assets',file),'utf8')).join('\n');
assert.ok(scripts.includes('modoo-cards.demo.v1'),'Demo must use isolated browser storage');
assert.ok(!/firebaseapp\.com|identitytoolkit\.googleapis\.com|\/api\/bootstrap|signInWithPopup/.test(scripts),'Demo must not contain account or Anki API clients');
assert.ok(!/https:\/\/[^\s"']+\.(?:onrender\.com|web\.app)/.test(scripts+html),'Demo must not reference a live private installation');
assert.ok(scripts.includes(base),'Runtime assets must include the repository prefix');
console.log('PASS: static demo assets, isolated storage and absence of auth/Anki API clients');
