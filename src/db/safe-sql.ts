// src/db/safe-sql.ts
import { getPool } from './index.js';

export function sql(strings: TemplateStringsArray, ...values: any[]) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return { text, params: values };
}

export async function querySql(strings: TemplateStringsArray, ...values: any[]) {
  const { text, params } = sql(strings, ...values);
  const pool = getPool();
  // @ts-ignore - pg types may vary
  return pool.query(text, params);
}