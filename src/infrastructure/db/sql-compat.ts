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
  begin: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  transaction: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
}

function createThenableQuery<T extends DatabaseRow = DatabaseRow>(
  exec: (text: string, params: unknown[]) => Promise<T[]>,
  strings: TemplateStringsArray,
  values: unknown[]
): Promise<T[]> & SqlFragment {
  const { text, values: params } = toQuery(strings, values);
  const fragment = asFragment(text, params) as Promise<T[]> & SqlFragment;
  return fragment;
}

export function buildSqlCompat(pool: Pool): SqlFunction {
  const exec = async <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> => {
    const { rows } = await pool.query<T>(text, params);
    return rows;
  };

  const core = (<T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]) =>
    createThenableQuery<T>(exec, strings, values)) as SqlFunction;

  const createThenableFragment = <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> & SqlFragment => {
    const frag = asFragment(text, params) as Promise<T[]> & SqlFragment;
    const _t = frag as Promise<T[]> & SqlFragment & { then?: (onFulfilled: (value: T[]) => unknown, onRejected?: (reason: unknown) => unknown) => unknown }; _t.then = (onFulfilled, onRejected?) => exec<T>(text, params).then(onFulfilled).catch(onRejected ?? ((err) => { throw err; }));
    return frag;
  };

  const unsafe = ((stringsOrText: TemplateStringsArray | string, ...vals: unknown[]) => {
    if (typeof stringsOrText === 'string') {
      const params = (vals[0] as unknown[]) || [];
      return createThenableFragment(stringsOrText, params);
    }
    const { text, values } = toQuery(stringsOrText, vals);
    return createThenableFragment(text, values);
  }) as SqlFunction['unsafe'];

  const join = (parts: Array<SqlFragment | string>, separator: SqlFragment | string = asFragment(', ')): SqlFragment => joinFragments(parts, separator);

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
    const { rows } = await client.query<T>(text, params);
    return rows;
  };

  const core = (<T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]) =>
    createThenableQuery<T>(exec, strings, values)) as SqlFunction;

  const createThenableFragment2 = <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[]): Promise<T[]> & SqlFragment => {
    const frag = asFragment(text, params) as Promise<T[]> & SqlFragment;
    const _t = frag as Promise<T[]> & SqlFragment & { then?: (onFulfilled: (value: T[]) => unknown, onRejected?: (reason: unknown) => unknown) => unknown }; _t.then = (onFulfilled, onRejected?) => exec<T>(text, params).then(onFulfilled).catch(onRejected ?? ((err) => { throw err; }));
    return frag;
  };

  const unsafe = ((stringsOrText: TemplateStringsArray | string, ...vals: unknown[]) => {
    if (typeof stringsOrText === 'string') {
      const params = (vals[0] as unknown[]) || [];
      return createThenableFragment2(stringsOrText, params);
    }
    const { text, values } = toQuery(stringsOrText, vals);
    return createThenableFragment2(text, values);
  }) as SqlFunction['unsafe'];

  const join = (parts: Array<SqlFragment | string>, separator: SqlFragment | string = asFragment(', ')): SqlFragment => joinFragments(parts, separator);

  Object.assign(core, {
    unsafe,
    join,
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

