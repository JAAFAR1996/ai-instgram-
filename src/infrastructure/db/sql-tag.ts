// src/infrastructure/db/sql-tag.ts
import type { Pool } from 'pg';
import type { DatabaseRow } from '../../types/db.js';

export type SqlParam = string | number | boolean | Date | Buffer | null;
export type SQLTag = <T extends DatabaseRow = DatabaseRow>(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<SqlParam>
) => Promise<T[]>;

function compileTemplate(strings: TemplateStringsArray, values: ReadonlyArray<SqlParam>) {
  // يبني نص استعلام بـ $1, $2 ... ويجمع values بالترتيب
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return { text, values };
}

/**
 * يبني sql`` tag فوق Pool.query بحيث:
 *   await sql`SELECT ... WHERE id = ${id}::uuid`
 * يرجّع rows مباشرةً (array)
 */
export function buildSQLTag(pool: Pool): SQLTag {
  return async <T extends DatabaseRow = DatabaseRow>(
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<SqlParam>
  ): Promise<T[]> => {
    const { text, values: params } = compileTemplate(strings, values);
    const { rows } = await pool.query<T>(text, params as any[]);
    return rows;
  };
}