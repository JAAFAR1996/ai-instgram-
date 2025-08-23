/**
 * ===============================================
 * Production-Grade Structured Logger
 * Replaces console.log with secure, redacted logging
 * ===============================================
 */

import crypto from 'crypto';

// serr function moved to isolation/context.ts to avoid duplicates

export interface LogContext {
  traceId?: string;
  correlationId?: string;
  requestId?: string;
  merchantId?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: any;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Tightened sensitive fields to reduce false positives
 */
const SENSITIVE_FIELDS = [
  'password','secret','token','authorization','api_key','client_secret',
  'webhook_secret','private_key','access_token','refresh_token','jwt',
  'x-hub-signature','x-hub-signature-256','cookie','set-cookie'
];

/**
 * Production-grade structured logger
 */
export class Logger {
  private context: LogContext = {};
  private minLevel: LogLevel = 'info';

  constructor(context: LogContext = {}) {
    this.context = context;
    this.minLevel = this.getLogLevel();
  }

  /**
   * Set global context for all log entries
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear specific context keys
   */
  clearContext(keys: string[]): void {
    keys.forEach(key => delete this.context[key]);
  }

  /**
   * Create child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger({ ...this.context, ...context });
    childLogger.minLevel = this.minLevel;
    return childLogger;
  }

  /**
   * Log at trace level
   */
  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context);
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log at info level
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log at error level
   */
  error(message: string, err?: Error | any, context?: LogContext): void;
  error(context: LogContext, message: string): void;
  error(arg1: string | LogContext, arg2?: any, arg3?: LogContext): void {
    if (typeof arg1 === 'string') {
      const message = arg1;
      const err = arg2;
      const context = arg3;
      this.log('error', message, { ...context, err });
    } else {
      const context = arg1;
      const message = typeof arg2 === 'string' ? arg2 : '';
      this.log('error', message, context);
    }
  }

  /**
   * Log at fatal level
   */
  fatal(message: string, err?: Error | any, context?: LogContext): void;
  fatal(context: LogContext, message: string): void;
  fatal(arg1: string | LogContext, arg2?: any, arg3?: LogContext): void {
    if (typeof arg1 === 'string') {
      const message = arg1;
      const err = arg2;
      const context = arg3;
      this.log('fatal', message, { ...context, err });
    } else {
      const context = arg1;
      const message = typeof arg2 === 'string' ? arg2 : '';
      this.log('fatal', message, context);
    }
  }

  /**
   * Core logging method with top-level context and error
   */
  private log(level: LogLevel, message: string, context?: LogContext & { err?: any; error?: any }): void {
    if (!this.shouldLog(level)) return;

    const ctx = this.redactSensitiveData({ ...this.context, ...(context || {}) }) as LogContext & { err?: any; error?: any };
    const { err, error, ...safeCtx } = ctx as any;
    const finalError = err ?? error;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      context: safeCtx,
      ...(finalError ? {
        error: (finalError instanceof Error)
          ? { name: finalError.name, message: finalError.message, stack: finalError.stack }
          : (typeof finalError === 'object' ? finalError : { message: String(finalError) })
      } : {})
    };

    // Remove timestamp from production output since Render adds its own
    if (process.env.NODE_ENV === 'production') {
      delete (entry as any).timestamp;
    }

    const out = (level === 'error' || level === 'fatal') ? process.stderr : process.stdout;
    if (process.env.NODE_ENV === 'production') {
      out.write(JSON.stringify(entry) + '\n');
    } else {
      out.write(`${entry.timestamp} ${level.toUpperCase().padEnd(5)} ${message}` +
                (Object.keys(safeCtx).length ? ` ${JSON.stringify(safeCtx)}` : '') +
                (entry.error ? ` ${JSON.stringify(entry.error)}` : '') + '\n');
    }
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      trace: 0,
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
      fatal: 5
    };

    return levels[level] >= levels[this.minLevel];
  }

  /**
   * Get log level from environment
   */
  private getLogLevel(): LogLevel {
    const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
    const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    return validLevels.includes(level) ? level : 'info';
  }

  /**
   * Redact sensitive information from logs
   */
  private redactSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const redacted = { ...data };

    // Redact sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      if (redacted[field] !== undefined) {
        if (typeof redacted[field] === 'string') {
          redacted[field] = this.maskString(redacted[field]);
        } else {
          redacted[field] = '[REDACTED]';
        }
      }
    }

    // Handle nested objects
    for (const [key, value] of Object.entries(redacted)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        redacted[key] = this.redactSensitiveData(value);
      } else if (Array.isArray(value)) {
        redacted[key] = value.map(item => 
          typeof item === 'object' ? this.redactSensitiveData(item) : item
        );
      }
    }

    // Special handling for headers
    if (redacted.headers) {
      redacted.headers = this.redactHeaders(redacted.headers);
    }

    return redacted;
  }

  /**
   * Redact HTTP headers with normalized key matching
   */
  private redactHeaders(headers: Record<string, any>): Record<string, any> {
    const redacted = { ...headers };
    
    for (const [key, value] of Object.entries(headers)) {
      const k = key.toLowerCase();
      if (SENSITIVE_FIELDS.includes(k)) {
        redacted[key] = this.maskString(String(value));
      }
    }

    return redacted;
  }

  /**
   * Mask string showing only first/last characters
   */
  private maskString(str: string): string {
    if (!str || typeof str !== 'string') return '[REDACTED]';
    if (str.length <= 4) return '***';
    
    const start = str.slice(0, 2);
    const end = str.slice(-2);
    const middle = '*'.repeat(Math.max(0, str.length - 4));
    
    return `${start}${middle}${end}`;
  }
}

/**
 * Global logger instance
 */
let globalLogger: Logger | null = null;

/**
 * Get global logger instance
 */
export function getLogger(context?: LogContext): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(context);
  } else if (context) {
    globalLogger.setContext(context);
  }
  return globalLogger;
}

/**
 * Create logger with specific context
 */
export function createLogger(context: LogContext): Logger {
  return new Logger(context);
}

/**
 * Bind request-scoped logger with IDs
 */
export function bindRequestLogger(
  base: Logger, 
  reqIds: { 
    requestId?: string; 
    traceId?: string; 
    correlationId?: string; 
    merchantId?: string; 
    userId?: string;
  }
): Logger {
  return base.child(reqIds);
}

/**
 * Request-scoped logger with trace ID
 */
export function createRequestLogger(traceId?: string, correlationId?: string): Logger {
  return new Logger({
    traceId: traceId || generateTraceId(),
    correlationId: correlationId || generateCorrelationId()
  });
}

/**
 * Generate trace ID
 */
function generateTraceId(): string {
  return `trace_${crypto.randomUUID()}`;
}

/**
 * Generate correlation ID
 */
function generateCorrelationId(): string {
  return `corr_${Date.now()}_${crypto.randomUUID()}`;
}

export default Logger;