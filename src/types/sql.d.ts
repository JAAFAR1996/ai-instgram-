// Ambient typing for our tagged-sql helper in ../db/index.js
// يمنحنا sql<T> => Promise<T[]> و sql.unsafe<T> => Promise<T[]>
declare module '../db/index.js' {
  export function sql<
    T extends Record<string, unknown> = Record<string, unknown>
  >(strings: TemplateStringsArray, ...args: unknown[]): Promise<T[]>;

  export namespace sql {
    function unsafe<
      T extends Record<string, unknown> = Record<string, unknown>
    >(query: string, ...args: unknown[]): Promise<T[]>;
  }
}
