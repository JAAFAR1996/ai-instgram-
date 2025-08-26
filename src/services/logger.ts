/**
 * ===============================================
 * Production-Grade Structured Logger
 * 🔧 Stage 5: Enhanced DevOps logging and monitoring
 * Replaces console.log with secure, redacted logging
 * ===============================================
 */

import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, access, mkdir, statfs } from 'fs';
import { join, dirname } from 'path';
import { gzip } from 'zlib';
import { promisify } from 'util';

// ✅ BREAKING CIRCULAR DEPENDENCY - No config import
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const fs = { access, mkdir, statfs };

const gzipAsync = promisify(gzip);
const accessAsync = promisify(fs.access);
const mkdirAsync = promisify(fs.mkdir);
const statfsAsync = promisify(fs.statfs);

// serr function moved to isolation/context.ts to avoid duplicates

export const LOG_LEVELS = {
  error: 0,
  warn: 1, 
  info: 2,
  debug: 3
} as const;

export function standardizeLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  return level && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level) ? level as LogLevel : 'info';
}

// ✅ Safe environment access without circular dependency
function getEnvironment(): string {
  return process.env.NODE_ENV || 'development';
}

// ✅ Safe config access without circular dependency
function getLogLevelFromEnv(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  return level && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level) 
    ? level as LogLevel 
    : 'info';
}

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
 * Comprehensive sensitive fields for production-grade data protection
 * Includes common patterns and variations to catch all sensitive data
 */
const SENSITIVE_FIELDS = [
  // Authentication & Authorization
  'password', 'passwd', 'pwd', 'secret', 'token', 'authorization', 'auth',
  'api_key', 'apikey', 'api_key', 'client_secret', 'clientsecret',
  'webhook_secret', 'webhooksecret', 'private_key', 'privatekey',
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
  'jwt', 'bearer', 'session', 'sessionid', 'session_id',
  
  // Headers & Cookies
  'x-hub-signature', 'x-hub-signature-256', 'x-api-key', 'x-auth-token',
  'cookie', 'set-cookie', 'authorization', 'x-authorization',
  
  // Database & Connection
  'db_password', 'database_password', 'db_secret', 'connection_string',
  'connectionstring', 'connection_url', 'connectionurl',
  
  // Payment & Financial
  'card_number', 'cardnumber', 'credit_card', 'creditcard',
  'cvv', 'cvc', 'expiry', 'expiration', 'account_number', 'accountnumber',
  
  // Social Media & OAuth
  'instagram_token', 'facebook_token', 'whatsapp_token', 'telegram_token',
  'oauth_token', 'oauth_secret', 'oauthsecret',
  
  // Encryption & Security
  'encryption_key', 'encryptionkey', 'decryption_key', 'decryptionkey',
  'signing_key', 'signingkey', 'hmac_key', 'hmackey',
  
  // Environment & Configuration
  'env_secret', 'env_secret', 'config_secret', 'configsecret',
  'deployment_key', 'deploymentkey', 'release_key', 'releasekey'
];

/**
 * Regex patterns for detecting sensitive data in strings
 */
const SENSITIVE_PATTERNS = [
  // API Keys (various formats)
  /api[_-]?key[_-]?[a-zA-Z0-9]{20,}/gi,
  /[a-zA-Z0-9]{32,}/g, // Long alphanumeric strings (likely tokens)
  
  // JWT tokens
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  
  // Credit card numbers (basic pattern)
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  
  // Email addresses (for PII protection)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  
  // Phone numbers (various formats)
  /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  
  // URLs with tokens
  /https?:\/\/[^\s]*[?&](token|key|secret|password)=[^\s&]*/gi
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
  private diskSpaceCheckTimer: NodeJS.Timeout | null = null;
  private totalLogsWritten = 0;
  private startTime = Date.now();
  
  // Duplicate message protection
  private duplicateCache: Map<string, { count: number; firstSeen: number; lastSeen: number }> = new Map();
  private duplicateThreshold = 5; // Max duplicates before throttling
  private duplicateWindow = 60000; // 1 minute window
  private duplicateCleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Ensure log directory exists with proper permissions
   */
  private async ensureLogDirectoryExists(): Promise<void> {
    const config = this.rotationConfig || {};
    if (!config.logDirectory) return;

    try {
      // Check if directory exists
      await accessAsync(dirname(config.logDirectory));
    } catch {
      // Create directory with recursive option
      await mkdirAsync(dirname(config.logDirectory), { recursive: true });
      
      // Verify directory was created successfully
      try {
        await accessAsync(dirname(config.logDirectory));
      } catch (error) {
        throw new Error(`Failed to create log directory: ${error}`);
      }
    }
  }

  constructor(
    context: LogContext = {},
    private rotationConfig?: Partial<LogRotationConfig>,
    private batchingConfig?: Partial<LogBatchingConfig>,
    private memoryConfig?: Partial<MemoryMonitoringConfig>
  ) {
    this.context = context;
    this.minLevel = getLogLevelFromEnv(); // ✅ Use safe function
    this.setupLogRotation().catch(error => {
      console.error('Failed to setup log rotation:', error);
    });
    this.setupLogBatching();
    this.setupMemoryMonitoring();
    this.setupDiskSpaceMonitoring();
    this.setupDuplicateProtection();
  }

  /**
   * Setup log rotation
   */
  private async setupLogRotation(): Promise<void> {
    const config = this.rotationConfig || {};
    if (!config.logDirectory) return;

    // Ensure log directory exists with proper permissions
    await this.ensureLogDirectoryExists();

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
   * Setup duplicate message protection cleanup
   */
  private setupDuplicateProtection(): void {
    // Clean up old entries every 5 minutes
    this.duplicateCleanupTimer = setInterval(() => {
      this.cleanupDuplicateCache();
    }, 300000); // 5 minutes
  }

  /**
   * Clean up old entries from duplicate cache
   */
  private cleanupDuplicateCache(): void {
    const now = Date.now();
    const cutoff = now - this.duplicateWindow;
    
    for (const [key, entry] of this.duplicateCache.entries()) {
      if (entry.lastSeen < cutoff) {
        this.duplicateCache.delete(key);
      }
    }
  }

  /**
   * Generate unique key for log message to detect duplicates
   */
  private generateMessageKey(level: LogLevel, message: string, context?: LogContext): string {
    const contextStr = context ? JSON.stringify(context) : '';
    return `${level}:${message}:${contextStr}`;
  }

  /**
   * Check if message is duplicate and should be throttled
   */
  private shouldThrottleDuplicate(level: LogLevel, message: string, context?: LogContext): boolean {
    const key = this.generateMessageKey(level, message, context);
    const now = Date.now();
    
    const entry = this.duplicateCache.get(key);
    if (!entry) {
      // First occurrence
      this.duplicateCache.set(key, { count: 1, firstSeen: now, lastSeen: now });
      return false;
    }
    
    // Update entry
    entry.count++;
    entry.lastSeen = now;
    
    // Check if within time window
    if (now - entry.firstSeen > this.duplicateWindow) {
      // Reset if outside window
      this.duplicateCache.set(key, { count: 1, firstSeen: now, lastSeen: now });
      return false;
    }
    
    // Throttle if too many duplicates
    if (entry.count > this.duplicateThreshold) {
      return true;
    }
    
    return false;
  }

  /**
   * Log throttled duplicate message
   */
  private logThrottledDuplicate(level: LogLevel, message: string, context?: LogContext): void {
    const key = this.generateMessageKey(level, message, context);
    const entry = this.duplicateCache.get(key);
    
    if (entry) {
      const throttledMessage = `[THROTTLED] ${message} (repeated ${entry.count} times in ${Math.round((Date.now() - entry.firstSeen) / 1000)}s)`;
      const throttledEntry: LogEntry = {
        level,
        timestamp: new Date().toISOString(),
        message: throttledMessage,
        context: {
          ...context,
          _throttled: true,
          _duplicateCount: entry.count,
          _timeWindow: Math.round((Date.now() - entry.firstSeen) / 1000)
        },
        metadata: {
          pid: process.pid,
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime(),
          environment: getEnvironment(),
          ...(process.env.npm_package_version && { version: process.env.npm_package_version })
        }
      };
      
      this.writeToConsole(throttledEntry);
      
      // Reset counter after logging throttled message
      entry.count = 0;
    }
  }

  /**
   * Setup disk space monitoring
   */
  private setupDiskSpaceMonitoring(): void {
    const config = this.rotationConfig || {};
    if (!config.logDirectory) return;

    // Check disk space every minute
    this.diskSpaceCheckTimer = setInterval(async () => {
      try {
        const logDir = config.logDirectory!;
        const stats = await statfsAsync(dirname(logDir));
        const freeSpaceMB = (stats.bavail * stats.bsize) / (1024 * 1024);
        const totalSpaceMB = (stats.blocks * stats.bsize) / (1024 * 1024);
        const usedSpacePercent = ((totalSpaceMB - freeSpaceMB) / totalSpaceMB) * 100;
        
        // Warn if free space is less than 100MB or disk usage is more than 90%
        if (freeSpaceMB < 100 || usedSpacePercent > 90) {
          this.warn('Low disk space for logs', {
            freeSpaceMB: Math.round(freeSpaceMB),
            totalSpaceMB: Math.round(totalSpaceMB),
            usedSpacePercent: Math.round(usedSpacePercent),
            threshold: { freeSpaceMB: 100, usedSpacePercent: 90 },
            logDirectory: logDir
          });
        }
      } catch (error) {
        // Silently fail disk space check
        console.error('Disk space check failed:', error);
      }
    }, 60000); // Check every minute
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
    const env = getEnvironment(); // ✅ Use safe function
    const out = (entry.level === 'error' || entry.level === 'fatal') ? process.stderr : process.stdout;
    
    if (env === 'production') {
      out.write(JSON.stringify(entry) + '\n');
    } else {
      const { context, error } = entry;
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
   * Safe error serialization that prevents [object Object]
   */
  private safeSerializeError(error: unknown): { name: string; message: string; stack?: string } {
    // استخدام النمط المُثبت من RedisErrorFactory
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {})
      };
    }

    if (typeof error === 'string') {
      return {
        name: 'Error',
        message: error
      };
    }

    if (error && typeof error === 'object') {
      const errorObj = error as any;
      let message = 'Unknown error';
      
      // محاولة استخراج message بطرق مختلفة
      if (typeof errorObj.message === 'string') {
        message = errorObj.message;
      } else if (typeof errorObj.code === 'string') {
        message = `Error code: ${errorObj.code}`;
      } else if (typeof errorObj.name === 'string') {
        message = `Error name: ${errorObj.name}`;
      } else {
        // استخدام JSON.stringify كآخر حل مع protection من circular references
        try {
          message = JSON.stringify(errorObj, null, 0);
        } catch {
          message = 'Error (serialization failed)';
        }
      }

      return {
        name: typeof errorObj.name === 'string' ? errorObj.name : 'Error',
        message
      };
    }

    return {
      name: 'Error',
      message: 'Unknown error occurred'
    };
  }

  /**
   * Core logging method with top-level context and error
   */
  private async log(level: LogLevel, message: string, context?: LogContext & { err?: unknown; error?: unknown }): Promise<void> {
    if (!this.shouldLog(level)) return;

    // Check for duplicate message throttling
    if (this.shouldThrottleDuplicate(level, message, context)) {
      this.logThrottledDuplicate(level, message, context);
      return;
    }

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
         environment: getEnvironment(), // ✅ Use safe function
         ...(process.env.npm_package_version && { version: process.env.npm_package_version })
       },
      ...(finalError ? {
        error: this.safeSerializeError(finalError)
      } : {})
    };

    // Apply environment-specific filtering
    if (this.shouldFilterLog(entry)) return;

    const env = getEnvironment();
    
    // Remove timestamp from production output since Render adds its own
    if (env === 'production') {
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
    const env = getEnvironment(); // ✅ Use safe function

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

  // ✅ Removed unused getLogLevel method - using getLogLevelFromEnv directly

  /**
   * Redact sensitive information from logs with enhanced pattern detection
   */
  private redactSensitiveData(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object') return data as Record<string, unknown>;

    const redacted = { ...data } as Record<string, unknown>;

    // Redact sensitive fields by name
    for (const field of SENSITIVE_FIELDS) {
      if (redacted[field] !== undefined) {
        if (typeof redacted[field] === 'string') {
          redacted[field] = this.maskString(redacted[field] as string);
        } else {
          redacted[field] = '[REDACTED]';
        }
      }
    }

    // Handle nested objects and arrays with pattern detection
    for (const [key, value] of Object.entries(redacted)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        redacted[key] = this.redactSensitiveData(value);
      } else if (Array.isArray(value)) {
        redacted[key] = value.map(item =>
          typeof item === 'object' ? this.redactSensitiveData(item) : item
        );
      } else if (typeof value === 'string') {
        // Apply pattern-based redaction to string values
        redacted[key] = this.redactStringPatterns(value);
      }
    }

    // Special handling for headers
    if (redacted.headers && typeof redacted.headers === 'object') {
      redacted.headers = this.redactHeaders(redacted.headers as Record<string, unknown>);
    }

    // Special handling for URLs and connection strings
    if (redacted.url && typeof redacted.url === 'string') {
      redacted.url = this.redactUrl(redacted.url);
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
   * Redact sensitive patterns in strings using regex
   */
  private redactStringPatterns(str: string): string {
    if (!str || typeof str !== 'string') return str;
    
    let redacted = str;
    
    // Apply each pattern for redaction
    for (const pattern of SENSITIVE_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => {
        // For JWT tokens, show only first and last parts
        if (match.includes('.')) {
          const parts = match.split('.');
          if (parts.length >= 3) {
            const firstPart = parts[0] || '';
            const lastPart = parts[parts.length - 1] || '';
            return `${firstPart.slice(0, 10)}...${lastPart.slice(-10)}`;
          }
        }
        
        // For other patterns, use standard masking
        return this.maskString(match);
      });
    }
    
    return redacted;
  }

  /**
   * Redact sensitive information from URLs
   */
  private redactUrl(url: string): string {
    if (!url || typeof url !== 'string') return url;
    
    try {
      const urlObj = new URL(url);
      
      // Redact sensitive query parameters
      const sensitiveParams = ['token', 'key', 'secret', 'password', 'api_key', 'auth'];
      for (const param of sensitiveParams) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      }
      
      // Redact sensitive path segments
      const pathParts = urlObj.pathname.split('/');
      const redactedPath = pathParts.map(part => {
        if (part && part.length > 20 && /^[a-zA-Z0-9_-]+$/.test(part)) {
          // Likely a token or ID
          return this.maskString(part);
        }
        return part || '';
      });
      urlObj.pathname = redactedPath.join('/');
      
      return urlObj.toString();
    } catch {
      // If URL parsing fails, apply pattern redaction
      return this.redactStringPatterns(url);
    }
  }

  /**
   * Get logger statistics
   */
  getStats(): {
    totalLogsWritten: number;
    queueSize: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    logFile?: string;
    logDirectory?: string;
  } {
    return {
      totalLogsWritten: this.totalLogsWritten,
      queueSize: this.logQueue.length,
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      ...(this.currentLogFile && { logFile: this.currentLogFile }),
      ...(this.rotationConfig?.logDirectory && { logDirectory: this.rotationConfig.logDirectory })
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

    if (this.diskSpaceCheckTimer) {
      clearInterval(this.diskSpaceCheckTimer);
      this.diskSpaceCheckTimer = null;
    }

    if (this.duplicateCleanupTimer) {
      clearInterval(this.duplicateCleanupTimer);
      this.duplicateCleanupTimer = null;
    }

    // Clear duplicate cache
    this.duplicateCache.clear();

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