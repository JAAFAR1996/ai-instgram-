import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';
import { ZodError } from 'zod';

export function registerErrorHandler(app: Hono): void {
  const log = getLogger({ component: 'http-error' });

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      log.warn('Validation error', { path: c.req.path, issues: err.issues });
      return c.json({ error: 'validation_error', details: err.issues }, 400);
    }
    log.error('Unhandled error', err as Error, { path: c.req.path, method: c.req.method });
    return c.json({ error: 'internal_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
}

