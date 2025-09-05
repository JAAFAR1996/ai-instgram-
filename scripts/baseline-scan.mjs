import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');
const REPORTS = resolve(ROOT, 'reports');

const includeGlobs = [
  "-g", "!node_modules",
  "-g", "!.git",
  "-g", "!dist",
  "-g", "!build",
  "-g", "!coverage",
];

// Use js (includes jsx) and ts (includes tsx)
const typeFilters = ["-tjs", "-tts"]; // js, ts

const patterns = [
  { key: "ts_ignore", pattern: "@ts-ignore" },
  { key: "ts_expect_error", pattern: "@ts-expect-error" },
  { key: "type_any_annotation", pattern: String.raw`:\\s*any\\b` },
  { key: "cast_as_any", pattern: String.raw`\\bas any\\b` },
  { key: "cast_as_unknown_as", pattern: String.raw`\\bas unknown as\\b` },
  { key: "non_null_assertion_member", pattern: String.raw`\\b[A-Za-z_]\\w*!\\.` },
  { key: "empty_catch_block", pattern: String.raw`catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}` },
  { key: "empty_promise_catch", pattern: String.raw`\\.catch\\s*\\(\\s*\\(\\s*[^)]*\\)\\s*=>\\s*\\{\\s*\\}\\s*\\)` },
  { key: "void_promise_silence", pattern: String.raw`\\bvoid\\s+\\w+\\s*[(]` },
  // Note: process.on(...) pattern omitted in baseline due to PCRE escaping on Windows; will add in PR6 CI gate via raw rg.
  { key: "promise_allsettled", pattern: String.raw`Promise\\.allSettled\\s*[(]` },
  { key: "eslint_disable", pattern: String.raw`eslint-disable` },
  { key: "silent_fallback_or", pattern: String.raw`\|\|\\s*(\"[^\"]*\"|'[^']*'|null|undefined)` },
];

function runRgPat(pat) {
  const args = [
    "-n",
    "-P", // PCRE2 for our patterns
    "-S", // smart case
    ...includeGlobs,
    ...typeFilters,
    "-e",
    pat,
  ];
  const res = spawnSync('rg', args, { encoding: 'utf8' });
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`rg failed for pattern ${pat}: ${res.stderr || res.stdout}`);
  }
  return res.stdout ?? '';
}

function collect() {
  const byKey = {};
  for (const { key, pattern } of patterns) {
    const out = runRgPat(pattern);
    const files = {};
    let total = 0;
    for (const line of out.split(/\r?\n/)) {
      if (!line) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const file = line.slice(0, idx);
      files[file] = (files[file] || 0) + 1;
      total += 1;
    }
    byKey[key] = { total, files };
  }
  return byKey;
}

function main() {
  mkdirSync(REPORTS, { recursive: true });
  const data = collect();
  const summary = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.total]));
  const out = {
    generated_at: new Date().toISOString(),
    root: ROOT,
    patterns: patterns.map(p => p.key),
    summary,
    by_pattern: data,
  };
  const outfile = resolve(REPORTS, 'silencing-baseline.json');
  writeFileSync(outfile, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outfile}`);
}

main();
