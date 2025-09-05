/**
 * SQL Type Definitions
 * Re-export types from postgres library
 */

// Import SqlFunction and SqlFragment from our custom implementation
export type { SqlFunction as Sql } from '../db/sql-template.js';
export type { SqlFragment } from '../infrastructure/db/sql-compat.js';

// Re-export postgres Fragment for compatibility (type only)
export type { Fragment } from 'postgres';

// Database row types
export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
}

// Generic SQL result type
export type SqlResult<T> = T[];

// Helper type for count queries
export interface CountResult {
  count: string;
}
