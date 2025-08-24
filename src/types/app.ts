// src/types/app.ts
export interface AppConfig {
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
  };
  redis: {
    url: string;
    keyPrefix: string;
  };
  instagram: {
    appId: string;
    appSecret: string;
    redirectUri: string;
    webhookSecret: string;
  };
  ai: {
    openai: {
      apiKey: string;
      model: string;
    };
  };
  server: {
    port: number;
    host: string;
  };
  meta: {
    version: string;
    environment: 'development' | 'staging' | 'production';
  };
}

export interface RequestContext {
  merchantId?: string;
  userId?: string;
  platform?: 'instagram' | 'facebook' | 'whatsapp';
  requestId: string;
  timestamp: Date;
}

export interface ServiceContext {
  config: AppConfig;
  logger: {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    debug(message: string, meta?: Record<string, unknown>): void;
  };
  metrics?: {
    increment(name: string, value?: number, tags?: Record<string, string>): void;
    gauge(name: string, value: number, tags?: Record<string, string>): void;
    histogram(name: string, value: number, tags?: Record<string, string>): void;
  };
}

export interface PlatformMessage {
  id: string;
  platform: 'instagram' | 'facebook' | 'whatsapp';
  platformMessageId: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface AIResponse {
  content: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  requiresHumanReview?: boolean;
}

export interface QueueJobOptions {
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  removeOnComplete?: number;
  removeOnFail?: number;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface ErrorWithContext extends Error {
  context?: Record<string, unknown>;
  statusCode?: number;
  isOperational?: boolean;
}