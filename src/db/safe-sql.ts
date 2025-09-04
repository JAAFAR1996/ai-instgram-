// src/db/safe-sql.ts
import { getPool } from './index.js';

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return { text, params: values };
}

export async function querySql<T extends Record<string, unknown> = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  const { text, params } = sql(strings, ...values);
  const pool = getPool();
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows as T[];
}
