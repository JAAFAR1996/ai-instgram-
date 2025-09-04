#!/usr/bin/env node
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = [join(ROOT, 'src'), join(ROOT, 'scripts')];

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

function transform(content) {
  return content
    .replace(/\|\|\s*''/g, "?? ''")
    .replace(/\|\|\s*""/g, '?? ""')
    .replace(/\|\|\s*null\b/g, '?? null')
    .replace(/\|\|\s*undefined\b/g, '?? undefined');
}

let changed = 0;
for (const dir of TARGET_DIRS) {
  const files = walk(dir);
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const after = transform(before);
    if (after !== before) {
      writeFileSync(file, after);
      changed++;
      console.log(`patched: ${file}`);
    }
  }
}
console.log(JSON.stringify({ changed }, null, 2));

