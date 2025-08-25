// Production-grade environment validation with explicit required keys.
import { validateKeyEntropy } from '../services/encryption.js';

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
  { key: 'IG_VERIFY_TOKEN' },
  { key: 'BASE_URL' },
  { key: 'CORS_ORIGINS' },
  { key: 'INTERNAL_API_KEY' },
  { key: 'JWT_SECRET' }
];

const ADDITIONAL_REQUIRED = [
  'DB_MAX_CONNECTIONS',
  'REDIS_MAX_RETRIES', 
  'RATE_LIMIT_MAX',
  'CORS_ORIGINS',
  'TRUSTED_PROXY_IPS'
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

export function validateProductionEnv(): void {
  for (const key of ADDITIONAL_REQUIRED) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

/**
 * Validate encryption key entropy and security
 */
export function validateEncryptionKeys(): void {
  const encryptionKeys = [
    { name: 'ENCRYPTION_KEY', value: process.env.ENCRYPTION_KEY },
    { name: 'ENCRYPTION_KEY_HEX', value: process.env.ENCRYPTION_KEY_HEX },
    { name: 'JWT_SECRET', value: process.env.JWT_SECRET }
  ];

  for (const { name, value } of encryptionKeys) {
    if (value) {
      const entropyValidation = validateKeyEntropy(value);
      
      if (!entropyValidation.isValid) {
        console.warn(`⚠️ ${name} entropy validation failed:`);
        console.warn(`   Score: ${entropyValidation.entropyScore}/100`);
        console.warn(`   Issues: ${entropyValidation.issues.join(', ')}`);
        console.warn(`   Recommendations: ${entropyValidation.recommendations.join(', ')}`);
        
        if (process.env.NODE_ENV === 'production') {
          throw new Error(`${name} entropy validation failed: ${entropyValidation.issues.join(', ')}`);
        }
      } else {
        console.log(`✅ ${name} entropy validation passed (Score: ${entropyValidation.entropyScore}/100)`);
      }
    }
  }
}

// Direct execution for CLI validation
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log('🔍 Validating production environment...');
    assertEnvStrict();
    validateProductionEnv();
    validateEncryptionKeys();
    console.log('✅ Production environment validation passed');
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Production environment validation failed:', errorMessage);
    process.exit(1);
  }
}