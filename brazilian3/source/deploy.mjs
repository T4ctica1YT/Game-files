// deploy.mjs -- assemble the playable web build.
//
//   node tools/deploy.mjs [gameDir] [outDir]
//
// Copies the engine (build/engine), the page shell and the game data into outDir,
// and writes data/manifest.json describing every file and whether it is streamed.
// Only changed files are copied, so re-running after an engine rebuild is quick.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = path.resolve(process.argv[2] || 'C:/Program Files (x86)/Steam/steamapps/common/AVIAOZIN3');
const outDir = path.resolve(process.argv[3] || path.join(gameDir, 'Web-Build'));
const dataDir = path.join(outDir, 'data');

// Game folders shipped to the browser. Player data and tooling leftovers stay behind.
const INCLUDE_ROOT_FILES = ['qssm.pak', 'quakespasm.pak', 'languages.txt'];
const INCLUDE_DIRS = ['id1', 'mg1'];
const EXCLUDE = [
  /^[^/]+\/(saves|autosave|backups|screenshots)(\/|$)/i,
  /^[^/]+\/config\.cfg$/i,         // the player's desktop settings; the browser keeps its own
  /^id1\/iplog\.dat$/i,
  /^id1\/spasm\d+\.png$/i,         // stray screenshots
  /^id1\/history\.txt$/i,
];
// Large assets are downloaded only when the engine first opens them.
const LAZY = [
  /^[^/]+\/maps\//i,
  /^[^/]+\/music\//i,
  /^id1\/fonts\/.*\.ttf$/i,
  /^[^/]+\/demos\//i,
  /\.dem$/i,
];

function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

function copyIfChanged(src, dst) {
  const s = fs.statSync(src);
  try {
    const d = fs.statSync(dst);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs - 2000) return false; // utimes keeps ms only; NTFS stores 100ns
  } catch { /* missing */ }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  fs.utimesSync(dst, s.atime, s.mtime);
  return true;
}

const files = [];
for (const f of INCLUDE_ROOT_FILES) if (fs.existsSync(path.join(gameDir, f))) files.push(f);
for (const d of INCLUDE_DIRS) if (fs.existsSync(path.join(gameDir, d))) files.push(...walk(path.join(gameDir, d), d));

const manifest = [];
const hash = crypto.createHash('sha1');
let copied = 0, eagerBytes = 0, lazyBytes = 0;
for (const rel of files.sort()) {
  if (EXCLUDE.some(re => re.test(rel))) continue;
  const src = path.join(gameDir, rel);
  const st = fs.statSync(src);
  const lazy = LAZY.some(re => re.test(rel)) ? 1 : 0;
  manifest.push([rel, st.size, lazy]);
  hash.update(rel + ':' + st.size + ':' + Math.floor(st.mtimeMs) + '\n');
  if (lazy) lazyBytes += st.size; else eagerBytes += st.size;
  if (copyIfChanged(src, path.join(dataDir, rel))) copied++;
}

// Drop files that are no longer part of the build.
const keep = new Set(manifest.map(m => m[0].toLowerCase()));
if (fs.existsSync(dataDir))
  for (const rel of walk(dataDir))
    if (rel !== 'manifest.json' && !keep.has(rel.toLowerCase())) fs.rmSync(path.join(dataDir, rel));

// Engine + page.
const engineDir = path.join(root, 'build', 'engine');
for (const f of ['qssm.js', 'qssm.wasm']) {
  hash.update(fs.readFileSync(path.join(engineDir, f)));
  copyIfChanged(path.join(engineDir, f), path.join(outDir, f));
}
const shellDir = path.join(root, 'qssm', 'Quake', 'web', 'shell');
for (const f of fs.readdirSync(shellDir)) copyIfChanged(path.join(shellDir, f), path.join(outDir, f));

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'manifest.json'),
  JSON.stringify({ version: hash.digest('hex').slice(0, 12), files: manifest }));

const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(`${manifest.length} files (${copied} copied) -> ${outDir}`);
console.log(`preloaded ${mb(eagerBytes)}, streamed on demand ${mb(lazyBytes)}`);
