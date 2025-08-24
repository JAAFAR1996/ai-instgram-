/**
 * ===============================================
 * Production-Grade Structured Logger
 * Replaces console.log with secure, redacted logging
 * ===============================================
 */

import { randomUUID } from 'crypto';
import { getConfig, type LogLevel } from '../config/index.js';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

// serr function moved to isolation/context.ts to avoid duplicates

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
  // Additional contextual fields should be JSON-safe primitives/objects
  [key: string]: unknown;
}

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
  metadata?: {
    pid: number;
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    environment: string;
    version?: string;
  };
}

/**
 * Log rotation configuration
 */
export interface LogRotationConfig {
  maxFileSize: number; // in bytes
  maxFiles: number;
  compressOldFiles: boolean;
  logDirectory: string;
  filename: string;
}

/**
 * Log batching configuration
 */
export interface LogBatchingConfig {
  enabled: boolean;
  batchSize: number;
  flushInterval: number; // in milliseconds
  maxQueueSize: number;
}

/**
 * Memory monitoring configuration
 */
export interface MemoryMonitoringConfig {
  enabled: boolean;
  threshold: number; // percentage of heap used
  checkInterval: number; // in milliseconds
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
 * Production-grade structured logger with advanced features
 */
export class Logger {
  private context: LogContext = {};
  private minLevel: LogLevel = 'info';
  private logQueue: LogEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private currentLogFile: string | null = null;
  private writeStream: NodeJS.WritableStream | null = null;
  private memoryCheckTimer: NodeJS.Timeout | null = null;
  private totalLogsWritten = 0;
  private startTime = Date.now();

  constructor(
    context: LogContext = {},
    private rotationConfig?: Partial<LogRotationConfig>,
    private batchingConfig?: Partial<LogBatchingConfig>,
    private memoryConfig?: Partial<MemoryMonitoringConfig>
  ) {
    this.context = context;
    this.minLevel = this.getLogLevel();
    this.setupLogRotation();
    this.setupLogBatching();
    this.setupMemoryMonitoring();
  }

  /**
   * Setup log rotation
   */
  private setupLogRotation(): void {
    const config = this.rotationConfig || {};
    if (!config.logDirectory) return;

    // Create log directory if it doesn't exist
    if (!existsSync(config.logDirectory)) {
      mkdirSync(config.logDirectory, { recursive: true });
    }

    this.currentLogFile = join(config.logDirectory, config.filename || 'app.log');
    this.writeStream = createWriteStream(this.currentLogFile, { flags: 'a' });
  }

  /**
   * Setup log batching
   */
  private setupLogBatching(): void {
    const config = this.batchingConfig || {};
    if (!config.enabled) return;

    const flushInterval = config.flushInterval || 1000;
    this.batchTimer = setInterval(() => {
      this.flushBatch();
    }, flushInterval);
  }

  /**
   * Setup memory monitoring
   */
  private setupMemoryMonitoring(): void {
    const config = this.memoryConfig || {};
    if (!config.enabled) return;

    const checkInterval = config.checkInterval || 30000; // 30 seconds
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, checkInterval);
  }

  /**
   * Check memory usage and log warning if threshold exceeded
   */
  private checkMemoryUsage(): void {
    const config = this.memoryConfig || {};
    const threshold = config.threshold || 80; // 80% default

    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (heapUsedPercent > threshold) {
      this.warn('High memory usage detected', {
        heapUsedPercent: Math.round(heapUsedPercent),
        threshold,
        memoryUsage: memUsage
      });
    }
  }

  /**
   * Flush batched logs
   */
  private async flushBatch(): Promise<void> {
    if (this.logQueue.length === 0) return;

    const batch = this.logQueue.splice(0);
    const config = this.batchingConfig || {};

    try {
      if (config.enabled && this.writeStream) {
        // Write to file
        const logData = batch.map(entry => JSON.stringify(entry)).join('\n') + '\n';
        this.writeStream.write(logData);
      } else {
        // Write to console
        for (const entry of batch) {
          this.writeToConsole(entry);
        }
      }

      this.totalLogsWritten += batch.length;
    } catch (error) {
      // Fallback to console if file writing fails
      for (const entry of batch) {
        this.writeToConsole(entry);
      }
    }
  }

  /**
   * Write log entry to console
   */
  private writeToConsole(entry: LogEntry): void {
    const config = getConfig();
    const out = (entry.level === 'error' || entry.level === 'fatal') ? process.stderr : process.stdout;
    
    if (config.environment === 'production') {
      out.write(JSON.stringify(entry) + '\n');
    } else {
      const { context, error, metadata, ...rest } = entry;
      out.write(`${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}` +
                (context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : '') +
                (error ? ` ${JSON.stringify(error)}` : '') + '\n');
    }
  }

  /**
   * Rotate log file if needed
   */
  private async rotateLogFile(): Promise<void> {
    const config = this.rotationConfig || {};
    if (!config.maxFileSize || !this.currentLogFile || !this.writeStream) return;

    try {
      const fs = await import('fs');
      const stats = await fs.promises.stat(this.currentLogFile);
      
      if (stats.size >= config.maxFileSize) {
        // Close current stream
        this.writeStream.end();
        
        // Rename current file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const oldFile = this.currentLogFile;
        const newFile = `${this.currentLogFile}.${timestamp}`;
        
        await fs.promises.rename(oldFile, newFile);
        
        // Compress old file if enabled
        if (config.compressOldFiles) {
          const fileContent = await fs.promises.readFile(newFile);
          const compressed = await gzipAsync(fileContent);
          await fs.promises.writeFile(`${newFile}.gz`, compressed);
          await fs.promises.unlink(newFile);
        }
        
        // Create new log file
        this.writeStream = createWriteStream(this.currentLogFile, { flags: 'a' });
        
                 // Remove old files if max files exceeded
         if (config.maxFiles && config.logDirectory) {
           const logDir = config.logDirectory;
           const files = await fs.promises.readdir(logDir);
           const logFiles = files.filter(f => f.startsWith(config.filename || 'app.log'));
             
           if (logFiles.length > config.maxFiles) {
             const sortedFiles = logFiles
               .map(f => ({ name: f, path: join(logDir, f) }))
               .sort((a, b) => {
                 const statsA = fs.statSync(a.path);
                 const statsB = fs.statSync(b.path);
                 return statsA.mtime.getTime() - statsB.mtime.getTime();
               });
             
             // Remove oldest files
             const filesToRemove = sortedFiles.slice(0, sortedFiles.length - config.maxFiles);
             for (const file of filesToRemove) {
               await fs.promises.unlink(file.path);
             }
           }
         }
      }
    } catch (error) {
      // Log error but don't throw
      console.error('Log rotation failed:', error);
    }
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
    const childLogger = new Logger(
      { ...this.context, ...context },
      this.rotationConfig,
      this.batchingConfig,
      this.memoryConfig
    );
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
  error(message: string, err?: Error | unknown, context?: LogContext): void;
  error(context: LogContext, message: string): void;
  error(arg1: string | LogContext, arg2?: unknown, arg3?: LogContext): void {
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
  fatal(message: string, err?: Error | unknown, context?: LogContext): void;
  fatal(context: LogContext, message: string): void;
  fatal(arg1: string | LogContext, arg2?: unknown, arg3?: LogContext): void {
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
  private async log(level: LogLevel, message: string, context?: LogContext & { err?: unknown; error?: unknown }): Promise<void> {
    if (!this.shouldLog(level)) return;

    const ctx = this.redactSensitiveData({ ...this.context, ...(context ?? {}) }) as LogContext & { err?: unknown; error?: unknown };
    const { err, error, ...safeCtx } = ctx as Record<string, unknown>;
    const finalError = err ?? error;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      context: safeCtx,
             metadata: {
         pid: process.pid,
         memoryUsage: process.memoryUsage(),
         uptime: process.uptime(),
         environment: getConfig().environment,
         ...(process.env.npm_package_version && { version: process.env.npm_package_version })
       },
      ...(finalError ? {
        error: (finalError instanceof Error)
          ? { name: finalError.name, message: String(finalError.message), ...(finalError.stack ? { stack: finalError.stack } : {}) }
          : (typeof finalError === 'object' && finalError !== null) 
            ? { name: String((finalError as any)?.name ?? 'Error'), message: String((finalError as any)?.message ?? finalError) }
            : { name: String((finalError as any)?.name ?? 'Error'), message: String((finalError as any)?.message ?? finalError) }
      } : {})
    };

    // Apply environment-specific filtering
    if (this.shouldFilterLog(entry)) return;

    const config = getConfig();
    
    // Remove timestamp from production output since Render adds its own
    if (config.environment === 'production') {
      const entryObj: Record<string, unknown> = { ...entry };
      delete entryObj.timestamp;
    }

    // Add to batch queue or write immediately
    const batchingConfig = this.batchingConfig || {};
    if (batchingConfig.enabled && this.logQueue.length < (batchingConfig.maxQueueSize || 1000)) {
      this.logQueue.push(entry);
    } else {
      if (batchingConfig.enabled) {
        // Queue is full, flush immediately
        await this.flushBatch();
        this.logQueue.push(entry);
      } else {
        // No batching, write immediately
        this.writeToConsole(entry);
      }
    }

    // Check if log rotation is needed
    await this.rotateLogFile();
  }

  /**
   * Check if log should be filtered based on environment
   */
  private shouldFilterLog(entry: LogEntry): boolean {
    const config = getConfig();
    const env = config.environment;

    // Filter debug logs in production
    if (env === 'production' && entry.level === 'debug') {
      return true;
    }

    // Filter trace logs in non-development environments
    if (env !== 'development' && entry.level === 'trace') {
      return true;
    }

    return false;
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
    return getConfig().logLevel;
  }

  /**
   * Redact sensitive information from logs
   */
  private redactSensitiveData(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object') return data as Record<string, unknown>;

    const redacted = { ...data } as Record<string, unknown>;

    // Redact sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      if (redacted[field] !== undefined) {
        if (typeof redacted[field] === 'string') {
          redacted[field] = this.maskString(redacted[field] as string);
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
    if (redacted.headers && typeof redacted.headers === 'object') {
      redacted.headers = this.redactHeaders(redacted.headers as Record<string, unknown>);
    }

    return redacted;
  }

  /**
   * Redact HTTP headers with normalized key matching
   */
  private redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
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

  /**
   * Get logger statistics
   */
  getStats(): {
    totalLogsWritten: number;
    queueSize: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    return {
      totalLogsWritten: this.totalLogsWritten,
      queueSize: this.logQueue.length,
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = null;
    }

    // Flush remaining logs
    await this.flushBatch();

    // Close write stream
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
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
 * Create logger with specific context and configuration
 */
export function createLogger(
  context: LogContext,
  rotationConfig?: Partial<LogRotationConfig>,
  batchingConfig?: Partial<LogBatchingConfig>,
  memoryConfig?: Partial<MemoryMonitoringConfig>
): Logger {
  return new Logger(context, rotationConfig, batchingConfig, memoryConfig);
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
  return `trace_${randomUUID()}`;
}

/**
 * Generate correlation ID
 */
function generateCorrelationId(): string {
  return `corr_${Date.now()}_${randomUUID()}`;
}

/**
 * Cleanup global logger
 */
export async function cleanupLogger(): Promise<void> {
  if (globalLogger) {
    await globalLogger.cleanup();
    globalLogger = null;
  }
}

// Simple logger export for backward compatibility with patches
export const logger = {
  debug(msg: string, fields?: Record<string, unknown>) { 
    getLogger().debug(msg, fields); 
  },
  info(msg: string, fields?: Record<string, unknown>) { 
    getLogger().info(msg, fields); 
  },
  warn(msg: string, fields?: Record<string, unknown>) { 
    getLogger().warn(msg, fields); 
  },
  error(msg: string, fields?: Record<string, unknown>) { 
    getLogger().error(msg, undefined, fields); 
  },
};

export default Logger;