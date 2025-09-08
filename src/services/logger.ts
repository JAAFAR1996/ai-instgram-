/**
 * Pino-based Logger Wrapper
 * يعتمد Pino للتسجيل مع واجهة متوافقة مع getLogger/Logger الحالية
 */

import pino, { Logger as PinoLogger } from 'pino';
import { randomUUID } from 'crypto';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  traceId?: string;
  correlationId?: string;
  requestId?: string;
  merchantId?: string;
  userId?: string;
  sessionId?: string;
  component?: string;
  environment?: string;
  version?: string;
  [key: string]: unknown;
}

function level(): LogLevel {
  const l = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return ['trace','debug','info','warn','error','fatal'].includes(l) ? (l as LogLevel) : 'info';
}

function basePino(bindings?: LogContext): PinoLogger {
  const isDev = (process.env.NODE_ENV || 'development') === 'development';
  const transport = isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined;
  return pino({
    level: level(),
    base: bindings || {},
    redact: {
      paths: [
        // Common auth fields (top-level or nested)
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        // ManyChat/Instagram webhook signatures (use bracket notation for hyphenated keys)
        'headers["x-hub-signature-256"]',
        'req.headers["x-hub-signature-256"]',
        'headers["x-signature-256"]',
        'req.headers["x-signature-256"]',
        'headers["x-signature"]',
        'req.headers["x-signature"]',
        // Generic sensitive keys
        'token',
        'password',
        'apiKey',
        'OPENAI_API_KEY',
        'MANYCHAT_API_KEY',
        'JWT',
        'jwt',
        'JWT_SECRET',
        'ENCRYPTION_KEY_HEX',
        'DATABASE_URL',
        'REDIS_URL',
      ],
      censor: '***redacted***'
    },
    transport
  });
}

export class Logger {
  private l: PinoLogger;
  private ctx: LogContext;
  // single root pino instance to avoid stacking child bindings repeatedly
  private static root: PinoLogger | null = null;
  private static getRoot(): PinoLogger {
    if (!Logger.root) Logger.root = basePino();
    return Logger.root;
  }
  constructor(context: LogContext = {}) {
    this.ctx = context || {};
    this.l = Logger.getRoot().child(this.ctx);
  }
  setContext(ctx: LogContext): void {
    // Rebind against root to prevent accumulating nested children
    this.ctx = { ...(this.ctx || {}), ...(ctx || {}) };
    this.l = Logger.getRoot().child(this.ctx);
  }
  child(bindings: Record<string, unknown>): Logger {
    // Create a fresh child logger bound to root with merged context
    return new Logger({ ...(this.ctx || {}), ...(bindings || {}) });
  }
  private log(level: 'debug'|'info'|'warn'|'error'|'fatal', a: unknown, b?: unknown, c?: unknown): void {
    let msg = '';
    let fields: Record<string, unknown> | undefined;
    let err: Error | undefined;
    if (typeof a === 'string') {
      msg = a;
      if (b instanceof Error) { err = b; fields = c as any; } else { fields = b as any; }
    } else if (typeof b === 'string') {
      fields = a as any;
      msg = b;
      if (c instanceof Error) err = c;
    } else {
      // Fallback
      msg = typeof a === 'string' ? a : (typeof b === 'string' ? (b as string) : '');
      fields = (a && typeof a === 'object') ? a as any : undefined;
    }
    (this.l as any)[level]({ ...(fields||{}), ...(err ? { err } : {}) }, msg);
  }
  debug(a: unknown, b?: unknown, c?: unknown): void { this.log('debug', a, b, c); }
  info(a: unknown, b?: unknown, c?: unknown): void { this.log('info', a, b, c); }
  warn(a: unknown, b?: unknown, c?: unknown): void { this.log('warn', a, b, c); }
  error(a: unknown, b?: unknown, c?: unknown): void { this.log('error', a, b, c); }
  fatal(a: unknown, b?: unknown, c?: unknown): void { this.log('fatal', a, b, c); }
  async cleanup(): Promise<void> { /* pino streams close automatically */ }
}

let globalLogger: Logger | null = null;
export function getLogger(context?: LogContext): Logger {
  if (!globalLogger) globalLogger = new Logger();
  // Do not mutate the global logger context; return a child when context is requested
  return context ? globalLogger.child(context) : globalLogger;
}

export function createLogger(context: LogContext): Logger { return new Logger(context); }

export function bindRequestLogger(base: Logger, reqIds: { requestId?: string; traceId?: string; correlationId?: string; merchantId?: string; userId?: string; }): Logger {
  return base.child(reqIds);
}

export function createRequestLogger(traceId?: string, correlationId?: string): Logger {
  return new Logger({ traceId: traceId || `trace_${randomUUID()}`, correlationId: correlationId || `corr_${Date.now()}_${randomUUID()}` });
}

export async function cleanupLogger(): Promise<void> { globalLogger = null; }

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>) { getLogger().debug(msg, fields); },
  info(msg: string, fields?: Record<string, unknown>) { getLogger().info(msg, fields); },
  warn(msg: string, fields?: Record<string, unknown>) { getLogger().warn(msg, fields); },
  error(msg: string, fields?: Record<string, unknown>) { getLogger().error(msg, undefined, fields); },
};

export default Logger;
