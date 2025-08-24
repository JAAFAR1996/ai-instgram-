// أنواع مشتركة آمنة للإنتاج
export type UnknownRec = Record<string, unknown>;

export type JsonVal =
  | string
  | number
  | boolean
  | null
  | JsonVal[]
  | { [k: string]: JsonVal };

export type JsonObject = { [k: string]: JsonVal };
export type JsonArray = JsonVal[];

export type MessageLike = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
};

export type Row<T extends object> = T;
export type Rows<T extends object> = T[]; // لمخرجات SQL

export function isRecord(v: unknown): v is UnknownRec {
  return typeof v === 'object' && v !== null;
}

export function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}
