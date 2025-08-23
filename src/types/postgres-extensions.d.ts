declare module 'postgres' {
  interface Sql<TTypes extends Record<string, unknown> = {}> {
    join(values: any[], separator: any): Sql<TTypes>;
  }
}

export {};