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
      if (['node_modules', '.git', 'dist', 'build', 'coverage', '.idea', '.vscode', 'tests', 'test'].includes(entry)) continue;
      walk(full, files);
    } else if (s.isFile()) {
      if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  }
  return files;
}

// Replace catch (e: any) with catch (e: unknown)
const RX = /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g;

let changed = 0;
for (const file of walk(SRC_DIR)) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(RX, 'catch ($1: unknown)');
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log(`patched: ${file}`);
  }
}
console.log(JSON.stringify({ changed }, null, 2));

