import { z } from 'zod';

export function must<T>(v: T | undefined | null, msg = 'Required value missing'): T {
  if (v === undefined || v === null) throw new Error(msg);
  return v;
}

export function firstOrNull<T>(arr: readonly T[] | undefined): T | null {
  return arr && arr.length > 0 ? arr[0]! : null;
}

export function firstOrThrow<T>(arr: readonly T[] | undefined, msg = 'Empty result'): T {
  const v = firstOrNull(arr);
  if (v === null) throw new Error(msg);
  return v;
}

export function asDate(v: string | Date, msg = 'Invalid date'): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(msg);
  return d;
}

export const NonEmptyString = z.string().min(1);
