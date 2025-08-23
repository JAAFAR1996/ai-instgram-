// Production-grade environment validation with explicit required keys.
type EnvSpec = {
  key: string;
  mask?: (v: string) => string;
};

const REQUIRED: EnvSpec[] = [
  { key: 'NODE_ENV' },
  { key: 'ENCRYPTION_KEY_HEX' },
  { key: 'DATABASE_URL' },
  { key: 'REDIS_URL' },
  { key: 'META_APP_ID' },
  { key: 'META_APP_SECRET' },
  { key: 'META_VERIFY_TOKEN' },
  { key: 'PUBLIC_BASE_URL' },
];

export function assertEnvStrict(): void {
  const missing: string[] = [];
  for (const { key } of REQUIRED) {
    const v = process.env[key];
    if (!v || v.trim() === '') missing.push(key);
    // disallow defaults-in-code: run simple heuristic during boot
    if (typeof v === 'string' && /^(default|changeme|placeholder)$/i.test(v)) {
      missing.push(`${key} (placeholder)`);
    }
  }
  if (missing.length) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    throw new Error(msg);
  }
}