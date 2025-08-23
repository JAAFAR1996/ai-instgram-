/**
 * ===============================================
 * Database Adapter - Bridge for Migration
 * Provides compatibility layer between old and new DB systems
 * ===============================================
 */

import { getPool } from './index.js';
import type { Pool, PoolClient } from 'pg';

/**
 * Adapter to mimic old postgres library interface
 * This makes migration easier by keeping the same API
 */
export class DatabaseAdapter {
  private pool: Pool;

  constructor() {
    this.pool = getPool();
  }

  /**
   * Get SQL function that mimics postgres tagged templates
   */
  getSQL() {
    return this.createSQLFunction();
  }

  /**
   * Create SQL function that converts tagged templates to regular queries
   */
  private createSQLFunction() {
    const sql = async (strings: TemplateStringsArray, ...values: any[]) => {
      let query = '';
      let paramIndex = 1;
      const params: any[] = [];

      for (let i = 0; i < strings.length; i++) {
        query += strings[i];
        if (i < values.length) {
          query += `$${paramIndex}`;
          params.push(values[i]);
          paramIndex++;
        }
      }

      try {
        const result = await this.pool.query(query, params);
        return result.rows;
      } catch (error) {
        console.error('SQL Query Error:', error);
        console.error('Query:', query);
        console.error('Params:', params);
        throw error;
      }
    };

    // Add helper methods
    sql.begin = async () => {
      const client = await this.pool.connect();
      await client.query('BEGIN');
      return client;
    };

    sql.commit = async (client: PoolClient) => {
      await client.query('COMMIT');
      client.release();
    };

    sql.rollback = async (client: PoolClient) => {
      await client.query('ROLLBACK');
      client.release();
    };

    return sql;
  }

  /**
   * Get raw pool for advanced operations
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Singleton instance
 */
let dbAdapter: DatabaseAdapter | null = null;

export function getDatabase(): DatabaseAdapter {
  if (!dbAdapter) {
    dbAdapter = new DatabaseAdapter();
  }
  return dbAdapter;
}

/**
 * Legacy compatibility - same interface as old connection.js
 */
export { getDatabase as default };
