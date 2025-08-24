// src/config/env.ts
export type EnvOptions = { required?: boolean; defaultValue?: string };

export function getEnv(name: string, opts: EnvOptions = {}): string {
  const { required = false, defaultValue } = opts;
  const v = process.env[name];
  if ((v === undefined || v === '') && required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v ?? (defaultValue ?? '');
}

export const isProduction = () => (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
export const isTest = () => (process.env.NODE_ENV ?? '').toLowerCase() === 'test';
export const isRender = () => process.env.IS_RENDER === 'true' || process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;