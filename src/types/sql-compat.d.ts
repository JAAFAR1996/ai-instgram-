/**
 * ===============================================
 * SQL Compatibility Types
 * Provides flexible SQL typing for database operations
 * Compatible with both strict and loose typing approaches
 * ===============================================
 */

// تليين توقيعات sql حتى لا نُجبر T على قيود DatabaseRow المتشددة
// + توفير sql.unsafe المستعملة في عدة ملفات
// + تعريف DatabaseRow كـ unknown حيثما لزم.

declare module '../db/index.js' {
  export type DBRow<T> = T & Record<string, unknown>;
  
  // نمط tag قابل للنداء مع unsafe
  export interface SqlTag {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unsafe: <T = any>(query: string, ...values: any[]) => Promise<T[]>;
  }
  
  export const sql: SqlTag;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const query: <T = any>(query: string, params?: any[]) => Promise<T[]>;
  
  // إرخاء القيد إن وُجد - توافق مع sql.d.ts
  export type DatabaseRow = Record<string, unknown>;
}

declare module '../db/sql-template.js' {
  export type DBRow<T> = T & Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SqlFunction = <T = any>(strings: TemplateStringsArray, ...values: any[]) => Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Sql<T = any> = Promise<T[]>;
  export const getSql: () => SqlFunction;
  
  // إرخاء القيد إن وُجد - توافق مع sql.d.ts
  export type DatabaseRow = Record<string, unknown>;
}

// fallback عام لو تمّت الإشارة إلى DatabaseRow بشكل عام
// توافق مع التعريفات الأخرى
type DatabaseRow = Record<string, unknown>;
