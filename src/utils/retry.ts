import { telemetry } from '../services/telemetry.js';
import { pushDLQ } from '../queue/dead-letter.js';

export type LoggerLike = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  debug?: (message: string, meta?: Record<string, unknown>) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number, baseMs = 250, factor = 2, jitter = 0.4) {
  const exp = baseMs * Math.pow(factor, attempt);
  const delta = exp * jitter * (Math.random() * 2 - 1); // +/- jitter
  return Math.max(50, Math.floor(exp + delta));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  key: string,
  opts: {
    attempts?: number;
    logger?: LoggerLike;
    payload?: unknown;
  } = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const logger = opts.logger;

  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) telemetry.counter('retries_total', 'Total retries').add(1, { key, attempt: String(i) });
      return await fn();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // Do not retry for explicit non-retryable errors (e.g., 4xx policy violations)
      const noRetry = (err as any)?.noRetry === true || (typeof (err as any)?.status === 'number' && (err as any).status < 500);
      if (noRetry) {
        // Surface error immediately without DLQ or further retries
        throw err;
      }
      if (i < attempts - 1) {
        const delay = computeBackoff(i);
        logger?.warn?.(`[retry] ${key}`, { attempt: i + 1, delay, error: err.message });
        await sleep(delay);
        continue;
      }
      // Exhausted
      telemetry.counter('errors_total', 'Total errors (exhausted retries)').add(1, { key });
      try {
        pushDLQ({ reason: key, payload: opts.payload, severity: 'high', category: 'other' });
        telemetry.counter('dlq_enqueued_total', 'DLQ enqueued items').add(1, { key });
      } catch {}
      throw err;
    }
  }
  // Should never reach here; defensive throw to satisfy type system
  throw new Error('withRetry: unreachable');
}
