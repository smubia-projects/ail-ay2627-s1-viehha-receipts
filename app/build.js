// Vercel build for the static frontend (app/public). No bundler: it only
//  1. writes public/config.js with the Cloud Run API URL (RECEIPTS_API_BASE, or VITE_API_BASE),
//  2. copies the chat parser the browser shares with the API (src/shared/parsers.js -> public/lib/),
//  3. copies the sample chats (samples/ -> public/samples/).
// All three outputs are gitignored and regenerated on every build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, 'public');

const apiBase = (process.env.RECEIPTS_API_BASE || process.env.VITE_API_BASE || 'http://localhost:8080').trim().replace(/\/+$/, '');
fs.writeFileSync(path.join(pub, 'config.js'), `window.RECEIPTS_API_BASE = ${JSON.stringify(apiBase)};\n`);

fs.mkdirSync(path.join(pub, 'lib'), { recursive: true });
fs.copyFileSync(path.join(here, 'src', 'shared', 'parsers.js'), path.join(pub, 'lib', 'parsers.js'));

fs.mkdirSync(path.join(pub, 'samples'), { recursive: true });
for (const f of fs.readdirSync(path.join(here, 'samples'))) {
  if (/\.(txt|json)$/.test(f)) fs.copyFileSync(path.join(here, 'samples', f), path.join(pub, 'samples', f));
}

console.log(`Frontend built: API at ${apiBase}`);
