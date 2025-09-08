// src/infrastructure/db/sql-compat.ts
import type { Pool, PoolClient } from 'pg';
import type { DatabaseRow } from '../../types/db.js';

// Internal marker to identify SQL fragments
const SQL_FRAGMENT_SYMBOL = Symbol('SQL_FRAGMENT');

export type SqlFragment = {
  [SQL_FRAGMENT_SYMBOL]: true;
  text: string;
  values: unknown[];
};

function isFragment(value: unknown): value is SqlFragment {
  return typeof value === 'object' && value !== null && (value as { [SQL_FRAGMENT_SYMBOL]?: true })[SQL_FRAGMENT_SYMBOL] === true;
}

function asFragment(text: string, values: unknown[] = []): SqlFragment {
  return { [SQL_FRAGMENT_SYMBOL]: true, text, values } as SqlFragment;
}

// Shift placeholders in fragment text by an offset: $1 -> $<1+offset>
function shiftPlaceholders(text: string, offset: number): string {
  if (offset === 0) return text;
  return text.replace(/\$(\d+)/g, (_m, d: string) => `$${Number(d) + offset}`);
}

// Join helper declared before usage
function joinFragments(parts: Array<SqlFragment | string>, separator: SqlFragment | string = asFragment(', ')): SqlFragment {
  const sepFrag = typeof separator === 'string' ? asFragment(separator) : separator;
  let text = '';
  const values: unknown[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0) {
      const shiftedSep = shiftPlaceholders(sepFrag.text, values.length);
      text += shiftedSep;
      values.push(...sepFrag.values);
    }
    const frag = typeof p === 'string' ? asFragment(p) : p;
    const shifted = shiftPlaceholders(frag.text, values.length);
    text += shifted;
    values.push(...frag.values);
  });
  return asFragment(text, values);
}

// Compile a tagged template into a single query text + params, flattening nested fragments
export function toQuery(strings: TemplateStringsArray, values: unknown[]): { text: string; values: unknown[] } {
  let text = '';
  const params: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const v = values[i];

      if (isFragment(v)) {
        const shifted = shiftPlaceholders(v.text, params.length);
        text += shifted;
        params.push(...v.values);
      } else if (Array.isArray(v)) {
        // Support arrays of fragments/values: join with commas by default
        const parts: SqlFragment[] = [];
        let localOffset = 0;
        for (const item of v) {
          if (isFragment(item)) {
            parts.push(item);
            localOffset += item.values.length;
          } else {
            parts.push(asFragment(`$${params.length + localOffset + 1}`, [item]));
            localOffset += 1;
          }
        }
        const joined = joinFragments(parts, asFragment(', '));
        const shifted = shiftPlaceholders(joined.text, params.length);
        text += shifted;
        params.push(...joined.values);
      } else if (typeof v === 'string' && v === '') {
        // empty fragment
      } else {
        params.push(v);
        text += `$${params.length}`;
      }
    }
  }

  return { text, values: params };
}

export interface SqlFunction {
  <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> & SqlFragment;
  unsafe: {
    <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> & SqlFragment;
    <T extends DatabaseRow = DatabaseRow>(text: string, params?: unknown[]): Promise<T[]> & SqlFragment;
  };
  join: (parts: Array<SqlFragment | string>, separator?: SqlFragment | string) => SqlFragment;
  and: (...parts: Array<SqlFragment | string>) => SqlFragment;
  or: (...parts: Array<SqlFragment | string>) => SqlFragment;
  where: (...parts: Array<SqlFragment | string>) => SqlFragment;
  like: (column: string, value: string) => SqlFragment;
  empty: SqlFragment;
  begin: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  transaction: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
}

interface PromiseWithProperties {
  [SQL_FRAGMENT_SYMBOL]: boolean;
  text: string;
  values: unknown[];
}

function createLazyThenable<T extends DatabaseRow = DatabaseRow>(
  exec: (text: string, params: unknown[]) => Promise<T[]>,
  text: string,
  params: unknown[]
): Promise<T[]> & SqlFragment {
  // Build a lazy thenable that executes only when awaited, while
  // still carrying fragment metadata for composition inside templates.
  const thenable: Partial<PromiseWithProperties> & {
    then?: <U>(onFulfilled?: (v: T[]) => U | Promise<U>, onRejected?: (e: any) => any) => Promise<U>;
  } = {};
  thenable[SQL_FRAGMENT_SYMBOL] = true;
  thenable.text = text;
  thenable.values = params;
  // Lazy execution on await/then
  (thenable as any).then = (onFulfilled?: any, onRejected?: any) => exec(text, params).then(onFulfilled, onRejected);
  return thenable as Promise<T[]> & SqlFragment;
}

function createThenableQuery<T extends DatabaseRow = DatabaseRow>(
  exec: (text: string, params: unknown[]) => Promise<T[]>,
  strings: TemplateStringsArray,
  values: unknown[]
): Promise<T[]> & SqlFragment {
  const { text, values: params } = toQuery(strings, values);
  return createLazyThenable<T>(exec, text, params);
}

export function buildSqlCompat(pool: Pool): SqlFunction {
  const exec = async <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> => {
    const trimmed = (text || '').trim();
    const upper = trimmed.toUpperCase();
    const isStmt = /^(WITH|SELECT|INSERT|UPDATE|DELETE)\b/.test(upper);
    if (!isStmt) {
      throw new Error(`Invalid SQL statement composed: "${trimmed.slice(0, 80)}"`);
    }
    const { rows } = await pool.query<T>(text, params);
    return rows;
  };

  const core = (<T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]) =>
    createThenableQuery<T>(exec, strings, values)) as SqlFunction;

  const createThenableFragment = <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> & SqlFragment => {
    // Do not execute now; build lazy thenable
    return createLazyThenable<T>(exec, text, params);
  };

  const unsafe = ((stringsOrText: TemplateStringsArray | string, ...vals: unknown[]) => {
    if (typeof stringsOrText === 'string') {
      const params = Array.isArray(vals[0]) ? vals[0] : [];
      return createThenableFragment(stringsOrText, params);
    }
    const { text, values } = toQuery(stringsOrText, vals);
    return createThenableFragment(text, values);
  }) as SqlFunction['unsafe'];

  const join = (parts: Array<SqlFragment | string>, separator: SqlFragment | string = asFragment(', ')): SqlFragment => joinFragments(parts, separator);

  const isEmpty = (p: SqlFragment | string): boolean => {
    const f = typeof p === 'string' ? asFragment(p) : p;
    return !f.text || f.text.trim().length === 0;
  };

  const and = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const xs = parts.filter(p => !isEmpty(p)).map(p => (typeof p === 'string' ? asFragment(p) : p));
    if (xs.length === 0) return asFragment('');
    return joinFragments(xs, asFragment(' AND '));
  };

  const or = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const xs = parts.filter(p => !isEmpty(p)).map(p => (typeof p === 'string' ? asFragment(p) : p));
    if (xs.length === 0) return asFragment('');
    const inner = joinFragments(xs, asFragment(' OR '));
    return asFragment(`(${inner.text})`, inner.values);
  };

  const where = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const body = and(...parts);
    if (isEmpty(body)) return asFragment('');
    return asFragment(`WHERE ${body.text}`, body.values);
  };

  const like = (column: string, value: string): SqlFragment => {
    // Column is injected as plain text; callers should pass trusted identifiers only.
    return asFragment(`LOWER(${column}) LIKE LOWER($1)`, [`%${value}%`]);
  };

  const begin = async <T>(fn: (sql: SqlFunction) => Promise<T>): Promise<T> => {
    const newClient = await pool.connect();
    await newClient.query('BEGIN');
    try {
      const result = await fn(buildSqlCompatFromClient(newClient));
      await newClient.query('COMMIT');
      return result;
    } catch (error) {
      await newClient.query('ROLLBACK');
      throw error;
    } finally {
      newClient.release();
    }
  };

  Object.assign(core, {
    unsafe,
    join,
    and,
    or,
    where,
    like,
    empty: asFragment(''),
    begin,
    commit: async () => {
      // No-op at pool level
    },
    rollback: async () => {
      // No-op at pool level
    },
    transaction: begin
  });

  return core;
}

export function buildSqlCompatFromClient(client: PoolClient): SqlFunction {
  const exec = async <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> => {
    const trimmed = (text || '').trim();
    const upper = trimmed.toUpperCase();
    const isStmt = /^(WITH|SELECT|INSERT|UPDATE|DELETE)\b/.test(upper);
    if (!isStmt) {
      throw new Error(`Invalid SQL statement composed: "${trimmed.slice(0, 80)}"`);
    }
    const { rows } = await client.query<T>(text, params);
    return rows;
  };

  const core = (<T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]) =>
    createThenableQuery<T>(exec, strings, values)) as SqlFunction;

  const createThenableFragment2 = <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> & SqlFragment => {
    // Do not execute now; build lazy thenable
    return createLazyThenable<T>(exec, text, params);
  };

  const unsafe = ((stringsOrText: TemplateStringsArray | string, ...vals: unknown[]) => {
    if (typeof stringsOrText === 'string') {
      const params = Array.isArray(vals[0]) ? vals[0] : [];
      return createThenableFragment2(stringsOrText, params);
    }
    const { text, values } = toQuery(stringsOrText, vals);
    return createThenableFragment2(text, values);
  }) as SqlFunction['unsafe'];

  const join = (parts: Array<SqlFragment | string>, separator: SqlFragment | string = asFragment(', ')): SqlFragment => joinFragments(parts, separator);

  const isEmpty = (p: SqlFragment | string): boolean => {
    const f = typeof p === 'string' ? asFragment(p) : p;
    return !f.text || f.text.trim().length === 0;
  };

  const and = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const xs = parts.filter(p => !isEmpty(p)).map(p => (typeof p === 'string' ? asFragment(p) : p));
    if (xs.length === 0) return asFragment('');
    return joinFragments(xs, asFragment(' AND '));
  };

  const or = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const xs = parts.filter(p => !isEmpty(p)).map(p => (typeof p === 'string' ? asFragment(p) : p));
    if (xs.length === 0) return asFragment('');
    const inner = joinFragments(xs, asFragment(' OR '));
    return asFragment(`(${inner.text})`, inner.values);
  };

  const where = (...parts: Array<SqlFragment | string>): SqlFragment => {
    const body = and(...parts);
    if (isEmpty(body)) return asFragment('');
    return asFragment(`WHERE ${body.text}`, body.values);
  };

  const like = (column: string, value: string): SqlFragment => {
    return asFragment(`LOWER(${column}) LIKE LOWER($1)`, [`%${value}%`]);
  };

  Object.assign(core, {
    unsafe,
    join,
    and,
    or,
    where,
    like,
    empty: asFragment(''),
    begin: async <T>(fn: (sql: SqlFunction) => Promise<T>): Promise<T> => fn(core),
    commit: async () => { await client.query('COMMIT'); },
    rollback: async () => { await client.query('ROLLBACK'); },
    transaction: async <T>(fn: (sql: SqlFunction) => Promise<T>): Promise<T> => {
      await client.query('BEGIN');
      try {
        const result = await fn(core);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });

  return core;
}
