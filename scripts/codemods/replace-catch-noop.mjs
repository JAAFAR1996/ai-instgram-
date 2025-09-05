#!/usr/bin/env node
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', 'coverage', '.idea', '.vscode'].includes(entry)) continue;
      walk(full, files);
    } else if (s.isFile()) {
      if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) files.push(full);
    }
  }
  return files;
}

const noopCatchPatterns = [
  /\.catch\(\s*\(\s*[^)]*\)\s*=>\s*\{\s*\}\s*\)/g,           // .catch((e)=>{})
  /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,                 // .catch(()=>{})
  /\.catch\(\s*function\s*\([^)]*\)\s*\{\s*\}\s*\)/g,         // .catch(function(e){})
];

function transform(content) {
  let out = content;
  for (const rx of noopCatchPatterns) {
    out = out.replace(rx, ".catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); })");
  }
  return out;
}

const files = walk(SRC_DIR);
let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log(`patched: ${file}`);
  }
}
console.log(JSON.stringify({ changed }, null, 2));

