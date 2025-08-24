// src/infrastructure/db/sql-compat.ts
import type { Pool, PoolClient } from 'pg';
import type { DatabaseRow } from '../../types/db.js';

export interface SqlFunction {
  <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe: {
    <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
    <T extends DatabaseRow = DatabaseRow>(text: string, params?: unknown[]): Promise<T[]>;
  };
  begin: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  transaction: <T = unknown>(fn: (sql: SqlFunction) => Promise<T>) => Promise<T>;
}

function compile(strings: TemplateStringsArray, values: unknown[]): { text: string; values: unknown[] } {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return { text, values };
}

export function buildSqlCompat(pool: Pool): SqlFunction {
  const core = async <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    const { text, values: params } = compile(strings, values);
    const { rows } = await pool.query<T>(text, params);
    return rows;
  };

  const unsafeTemplate = async <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...vals: unknown[]): Promise<T[]> => {
    const { text, values } = compile(strings, vals);
    const { rows } = await pool.query<T>(text, values);
    return rows;
  };

  const unsafeText = async <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[] = []): Promise<T[]> => {
    const { rows } = await pool.query<T>(text, params);
    return rows;
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

  const sql = core as SqlFunction;
  Object.assign(sql, {
    unsafe: Object.assign(unsafeTemplate, { text: unsafeText }),
    begin,
    commit: async () => {
      // No-op at pool level
    },
    rollback: async () => {
      // No-op at pool level
    },
    transaction: begin
  });

  return sql;
}

function buildSqlCompatFromClient(client: PoolClient): SqlFunction {
  const core = async <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    const { text, values: params } = compile(strings, values);
    const { rows } = await client.query<T>(text, params);
    return rows;
  };

  const unsafeTemplate = async <T extends DatabaseRow = DatabaseRow>(strings: TemplateStringsArray, ...vals: unknown[]): Promise<T[]> => {
    const { text, values } = compile(strings, vals);
    const { rows } = await client.query<T>(text, values);
    return rows;
  };

  const unsafeText = async <T extends DatabaseRow = DatabaseRow>(text: string, params: unknown[] = []): Promise<T[]> => {
    const { rows } = await client.query<T>(text, params);
    return rows;
  };

  const sql = core as SqlFunction;
  Object.assign(sql, {
    unsafe: Object.assign(unsafeTemplate, { text: unsafeText }),
    begin: async <T>(fn: (sql: SqlFunction) => Promise<T>): Promise<T> => fn(sql),
    commit: async () => { await client.query('COMMIT'); },
    rollback: async () => { await client.query('ROLLBACK'); },
    transaction: async <T>(fn: (sql: SqlFunction) => Promise<T>): Promise<T> => {
      await client.query('BEGIN');
      try {
        const result = await fn(sql);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });

  return sql;
}