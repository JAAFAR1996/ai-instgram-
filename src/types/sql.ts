/**
 * SQL Type Definitions
 * Re-export types from postgres library
 */

// Import SqlFunction from our custom implementation
import type { SqlFunction } from '../db/sql-template.js';
export type { SqlFunction as Sql } from '../db/sql-template.js';

// Define proper Fragment type for our SqlFunction
// SqlFragments are SQL template literals that can be composed
export type SqlFragment = ReturnType<SqlFunction>;

// Re-export postgres Fragment for compatibility
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