/**
 * ===============================================
 * PostgreSQL Extensions Type Definitions
 * TypeScript module augmentations for postgres library
 * 
 * ✅ Extends postgres library with custom methods
 * ✅ Provides type safety for SQL operations
 * ✅ Supports dynamic SQL query building
 * ✅ No conflicts with other type files
 * ===============================================
 */

/**
 * Module augmentation for postgres library
 * Extends the postgres library with custom methods and types
 */
declare module 'postgres' {
  /**
   * Extended Sql interface with custom methods
   * Provides additional functionality for SQL query building
   * 
   * @template TTypes - Type definitions for the SQL context
   */
  interface Sql<TTypes extends Record<string, unknown> = {}> {
    /**
     * Joins SQL fragments with a separator
     * Used for building dynamic SQL queries with multiple conditions
     * 
     * @param values - Array of SQL fragments to join
     * @param separator - SQL fragment to use as separator between values
     * @returns Combined SQL fragment
     * 
     * @example
     * ```typescript
     * const conditions = [sql`id = ${id}`, sql`active = true`];
     * const whereClause = sql.join(conditions, sql` AND `);
     * // Result: sql`id = $1 AND active = true`
     * ```
     */
    join(values: unknown[], separator: unknown): unknown;
  }
}

export {};