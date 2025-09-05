#!/usr/bin/env node
import { build } from 'esbuild';
import { readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const fp = join(dir, name);
    const st = statSync(fp);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
      out = walk(fp, out);
    } else if (st.isFile()) {
      if (/(\.test\.ts|\.spec\.ts)$/i.test(name)) continue;
      if (/\.(ts|mts|cts)$/.test(name)) out.push(fp);
    }
  }
  return out;
}

async function main() {
  const entryPoints = walk(join(process.cwd(), 'src'));
  if (entryPoints.length === 0) {
    console.error('No TypeScript entry points found under src/');
    process.exit(1);
  }

  // Build TS to dist preserving folder structure
  await build({
    entryPoints,
    outdir: 'dist',
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    logLevel: 'info',
    tsconfig: 'tsconfig.json',
    bundle: false,
    metafile: false,
  });

  // Copy runtime assets we commonly need (migrations if present)
  const candidates = [
    ['src', 'database', 'migrations'],
    ['migrations']
  ];
  for (const parts of candidates) {
    const srcDir = join(process.cwd(), ...parts);
    try {
      const st = statSync(srcDir);
      if (!st.isDirectory()) continue;
      const rel = parts[0] === 'src' ? ['dist', ...parts.slice(1)] : parts;
      const dstDir = join(process.cwd(), ...rel);
      mkdirSync(dstDir, { recursive: true });
      for (const f of readdirSync(srcDir)) {
        if (/\.sql$/i.test(f)) {
          copyFileSync(join(srcDir, f), join(dstDir, f));
        }
      }
      break;
    } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
