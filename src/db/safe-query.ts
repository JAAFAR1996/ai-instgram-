import { z } from 'zod';
import { query as _rawQuery } from '../db/index.js';
const rawQuery = _rawQuery as unknown as (text: string, values?: unknown[]) => Promise<any[]>;

// استدعاء آمن: نص + قيم
export async function q<T extends z.ZodTypeAny>(
  schema: T,
  text: string,
  values: unknown[] = []
): Promise<z.infer<T>[]> {
  const rows = await rawQuery(text, values);
  return schema.array().parse(rows);
}

// مساعد اختياري لبناء استعلام parametrized من template literal
export function sql(texts: TemplateStringsArray, ...vals: unknown[]): { text: string; values: unknown[] } {
  let text = '';
  const values: unknown[] = [];
  texts.forEach((t, i) => {
    text += t;
    if (i < vals.length) {
      values.push(vals[i]);
      text += `$${values.length}`;
    }
  });
  return { text, values };
}

export async function qsql<T extends z.ZodTypeAny>(
  schema: T,
  tpl: { text: string; values: unknown[] }
): Promise<z.infer<T>[]> {
  const rows = await rawQuery(tpl.text, tpl.values);
  return schema.array().parse(rows);
}
