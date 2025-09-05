export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_ENV'
  | 'INTEGRATION_ERROR'
  | 'DB_ERROR'
  | 'REDIS_ERROR'
  | 'QUEUE_ERROR'
  | 'UNEXPECTED';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly safeMessage: string;
  constructor(code: AppErrorCode, message: string, opts?: { status?: number; safeMessage?: string; cause?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts?.status ?? 500;
    this.safeMessage = opts?.safeMessage ?? 'internal_error';
    // optional cause is kept on instance via native Error in modern runtimes; no unsafe casts
  }
}

export function toAppError(e: unknown, fallback: { code?: AppErrorCode; status?: number; safeMessage?: string } = {}): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) {
    return new AppError(fallback.code ?? 'UNEXPECTED', e.message, { status: fallback.status ?? 500, safeMessage: fallback.safeMessage ?? 'internal_error', cause: e });
  }
  return new AppError(fallback.code ?? 'UNEXPECTED', String(e), { status: fallback.status ?? 500, safeMessage: fallback.safeMessage ?? 'internal_error', cause: e });
}

export function serializeError(e: unknown): { name?: string; message?: string; code?: unknown; stack?: string; cause?: string } {
  const err = e as { name?: string; message?: string; code?: unknown; stack?: string; cause?: unknown };
  const result: { name?: string; message?: string; code?: unknown; stack?: string; cause?: string } = {};
  if (err?.name !== undefined) result.name = err.name;
  if (err?.message !== undefined) result.message = err.message;
  if (err?.code !== undefined) result.code = err.code;
  if (err?.stack !== undefined) result.stack = err.stack;
  const causeMessage = (err?.cause as { message?: string } | undefined)?.message;
  if (causeMessage !== undefined) result.cause = causeMessage;
  return result;
}

// Lightweight Result type helpers
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(v: T): Result<T> => ({ ok: true, value: v });
export const err = <E = AppError>(e: E): Result<never, E> => ({ ok: false, error: e });
