// src/db/sql-template.ts
export type { SqlFunction } from '../infrastructure/db/sql-compat.js';
export { buildSqlCompat as getSQLFromPool, buildSqlCompat as getSql } from '../infrastructure/db/sql-compat.js';
export type Sql = import('../infrastructure/db/sql-compat.js').SqlFunction;

// Helper functions for array values
export function sqlArray(values: unknown[]): string {
  return `(${values.map((_, i) => `$${i + 1}`).join(', ')})`;
}

export function sqlValues(values: unknown[][]): string {
  let paramIndex = 1;
  return values.map(row => 
    `(${row.map(() => `$${paramIndex++}`).join(', ')})`
  ).join(', ');
}