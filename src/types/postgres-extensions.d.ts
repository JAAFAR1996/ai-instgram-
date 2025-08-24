declare module 'postgres' {
  // Extension for postgres library if needed in future
  interface Sql<TTypes extends Record<string, unknown> = {}> {
    join(values: any[], separator: any): Sql<TTypes>;
  }
}

export {};