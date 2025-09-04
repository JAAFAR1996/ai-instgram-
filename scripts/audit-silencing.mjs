// audit-silencing.mjs
// Node: >=16. Usage:
//   node scripts/audit-silencing.mjs            # stdout JSON
//   node scripts/audit-silencing.mjs --pretty   # pretty JSON
//   node scripts/audit-silencing.mjs --out reports/silencing-audit.json --pretty
//
// يفحص المشروع ويعدّ كل "أدوات الإسكـات" الشائعة. لا يحتاج تبعيات.
// يستثني تلقائياً: node_modules, .git, dist, build, coverage, .next, out

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- config ----------
const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'test', 'tests'
]);
const EXT_ALLOW = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

// أنماط الإسكـات (Regexات شاملة)
const PATTERNS = {
  tsIgnore: /@ts-ignore/g,
  tsExpectError: /@ts-expect-error/g,
  tsNoCheck: /@ts-nocheck/g,
  istanbulIgnore: /istanbul\s+ignore\s+next/g,
  c8Ignore: /c8\s+ignore\s+next/g,

  // any / casts خطرة
  typeAny: /:\s*any\b/g,
  asAny: /\bas any\b/g,
  asUnknownAs: /\bas unknown as\b/g,

  // non-null assertion
  nonNullAssert: /\b[A-Za-z_]\w*!\./g,

  // catch صامتة
  emptyCatchBlock: /catch\s*\([^)]*\)\s*\{\s*\}/g, // بلا أي شيء
  catchIgnoreComment: /catch\s*\([^)]*\)\s*\{\s*(?:\/\*[^]*?\*\/|\/\/[^\n]*)\s*\}/g, // تعليق فقط
  catchNoopArrow: /\.catch\s*\(\s*\(\s*[^)]*\)\s*=>\s*\{\s*\}\s*\)/g,
  catchToNullish: /\.catch\s*\(\s*\(\s*[^)]*\)\s*=>\s*(?:null|undefined)\s*\)/g,
  catchBoolean: /\.catch\s*\(\s*Boolean\s*\)/g,
  thenSecondArg: /\.then\s*\(\s*[^,)]*\s*,\s*[^)]+\)/g, // onRejected ثاني

  // قتل التحذيرات
  voidPrefixCall: /\bvoid\s+[A-Za-z_]\w*\s*\(/g,

  // fallbacks صامتة
  falsyOrStringNullUndef: /\|\|\s*(?:''|""|null|undefined)\b/g,
  falsyOrOther: /\|\|\s*(?:0|false|NaN)\b/g,

  // معالجات عملية بدون إنهاء واضح (نفحص بذكاء لاحقاً)
  processHandlers: /process\.on\(\s*['"](uncaughtException|unhandledRejection)['"]\s*,/g,

  // eslint تعطيل
  eslintDisable: /eslint-disable/g,

  // Promise.allSettled تجاهل إخفاقات
  allSettled: /Promise\.allSettled\s*\(/g,
};

// ---------- helpers ----------
function isExcludedDir(name) {
  return EXCLUDE_DIRS.has(name);
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath);
  return EXT_ALLOW.has(ext);
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!isExcludedDir(e.name)) yield* walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      const fp = path.join(dir, e.name);
      if (shouldScanFile(fp)) yield fp;
    }
  }
}

function countMatches(re, text) {
  let m, c = 0;
  if (!re.global) re = new RegExp(re.source, re.flags + 'g');
  while ((m = re.exec(text)) !== null) c++;
  return c;
}

function countProcessHandlersWithoutExit(text) {
  // إذا وُجد process.on(... uncaught/unhandled ...) في الملف
  // ولم نجد exit(1|غير صفر) في نفس الملف → نعدّه "صامت محتمل"
  const handlers = countMatches(PATTERNS.processHandlers, text);
  if (!handlers) return 0;
  const hasExitNonZero =
    /\bprocess\.exit\s*\(\s*(?:1|[2-9]|\d{2,})\s*\)/.test(text) ||
    /\bprocess\.exit\s*\(\s*[^0\)]/.test(text); // أي قيمة غير صفر تقريبياً
  return hasExitNonZero ? 0 : handlers;
}

// ---------- main ----------
function audit() {
  const perFile = {};
  const totals = {};
  for (const key of Object.keys(PATTERNS)) totals[key] = 0;

  for (const filePath of walk(ROOT)) {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const fileHits = {};
    let hasAnyHit = false;

    for (const [k, re] of Object.entries(PATTERNS)) {
      if (k === 'processHandlers') continue; // سنحسبه بمُنطق خاص
      const n = countMatches(re, text);
      if (n > 0) {
        fileHits[k] = n;
        totals[k] += n;
        hasAnyHit = true;
      }
    }

    // معالجة خاصة لمعالِجات العملية بدون exit غير صفري
    const ph = countProcessHandlersWithoutExit(text);
    if (ph > 0) {
      fileHits.processHandlers = (fileHits.processHandlers || 0) + ph;
      totals.processHandlers += ph;
      hasAnyHit = true;
    }

    if (hasAnyHit) perFile[filePath] = fileHits;
  }

  // تلخيص أعلى الملفات
  const topFiles = Object.entries(perFile)
    .map(([fp, hits]) => [fp, Object.values(hits).reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([fp, total]) => ({ file: fp, total }));

  // تفصيل حسب النوع
  const byKind = Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));

  return {
    root: ROOT,
    scanned_extensions: [...EXT_ALLOW],
    excluded_dirs: [...EXCLUDE_DIRS],
    totals: byKind,
    files_count: Object.keys(perFile).length,
    top_files: topFiles,
    per_file: perFile,
    timestamp: new Date().toISOString(),
    note:
      'processHandlers يُحتسب فقط إذا لم نجد process.exit(non-zero) في الملف نفسه. falsyOr* ترصد استخدام || لفولباكات صامتة.'
  };
}

// ---------- cli ----------
function parseArgs(argv) {
  const args = { pretty: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretty') args.pretty = true;
    else if (a === '--out') args.out = argv[++i] ?? null;
  }
  return args;
}

const args = parseArgs(process.argv);
const report = audit();

if (args.out) {
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, args.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report));
}

const payload = args.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
console.log(payload);
