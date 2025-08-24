export function isStringArray(a: unknown): a is string[] {
  return Array.isArray(a) && a.every(x => typeof x === 'string');
}

export function ensureString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function toInt(v: unknown, fallback = 0): number {
  const n = parseInt(typeof v === 'string' ? v : String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
