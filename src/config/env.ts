// src/config/env.ts
export type EnvOptions = { required?: boolean; defaultValue?: string };

export function getEnv(name: string, opts: EnvOptions = {}): string {
  const { required = false, defaultValue } = opts;
  const v = process.env[name];
  if ((v === undefined || v === '') && required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v ?? (defaultValue ?? '');
}

export const isProduction = () => (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
export const isTest = () => (process.env.NODE_ENV ?? '').toLowerCase() === 'test';
export const isRender = () => process.env.IS_RENDER === 'true' || process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;

// ===============================================
// ManyChat Configuration Constants
// ===============================================

/**
 * ManyChat API Configuration
 * Rate limiting: 10 requests per second
 * Base URL: https://api.manychat.com
 */
export const MANYCHAT_CONFIG = {
  // API Configuration
  API_KEY: 'MANYCHAT_API_KEY',
  BASE_URL: 'MANYCHAT_BASE_URL',
  WEBHOOK_SECRET: 'MANYCHAT_WEBHOOK_SECRET',
  
  // Flow Configuration (removed - using ManyChat defaults)
  
  // Rate Limiting
  RATE_LIMIT_RPS: 10,
  RATE_LIMIT_WINDOW_MS: 1000,
  
  // Retry Configuration
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  
  // Circuit Breaker
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT_MS: 30000,
  
  // Cache Configuration
  CREDENTIALS_CACHE_TTL_MS: 60 * 60 * 1000, // 1 hour
  SUBSCRIBER_CACHE_TTL_MS: 30 * 60 * 1000,  // 30 minutes
  
  // Message Tags
  MESSAGE_TAGS: {
    CUSTOMER_FEEDBACK: 'CUSTOMER_FEEDBACK',
    COMMENT_RESPONSE: 'COMMENT_RESPONSE',
    STORY_INTERACTION: 'STORY_INTERACTION',
    STORY_MENTION: 'STORY_MENTION',
    PRICE_INQUIRY: 'PRICE_INQUIRY',
    PURCHASE_INTENT: 'PURCHASE_INTENT',
    CUSTOMER_SUPPORT: 'CUSTOMER_SUPPORT'
  },
  
  // Platform Types
  PLATFORMS: {
    INSTAGRAM: 'instagram',
    WHATSAPP: 'whatsapp',
    FACEBOOK: 'facebook',
    TELEGRAM: 'telegram'
  },
  
  // Interaction Types
  INTERACTION_TYPES: {
    DM: 'dm',
    COMMENT: 'comment',
    STORY_REPLY: 'story_reply',
    STORY_MENTION: 'story_mention',
    POST_COMMENT: 'post_comment',
    REEL_COMMENT: 'reel_comment'
  }
} as const;

/**
 * Get ManyChat environment variable with validation
 */
export function getManyChatEnv(name: keyof typeof MANYCHAT_CONFIG, opts: EnvOptions = {}): string {
  const envKey = MANYCHAT_CONFIG[name];
  if (typeof envKey !== 'string') {
    throw new Error(`Invalid ManyChat config key: ${name}`);
  }
  return getEnv(envKey, opts);
}

/**
 * Validate ManyChat configuration
 */
export function validateManyChatConfig(): {
  isValid: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];
  
  // Required variables
  const requiredVars = [
    MANYCHAT_CONFIG.API_KEY
  ];
  
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }
  
  // Optional but recommended variables
  const recommendedVars = [
    MANYCHAT_CONFIG.WEBHOOK_SECRET
  ];
  
  for (const envVar of recommendedVars) {
    if (!process.env[envVar]) {
      warnings.push(`${envVar} is not set (optional but recommended)`);
    }
  }
  
  return {
    isValid: missing.length === 0,
    missing,
    warnings
  };
}

/**
 * Get ManyChat configuration object
 */
export function getManyChatConfig(): {
  apiKey: string;
  baseUrl: string;
  webhookSecret?: string;
  defaultFlowId?: string;
  welcomeFlowId?: string;
  aiResponseFlowId?: string;
  commentResponseFlowId?: string;
  storyResponseFlowId?: string;
} {
  const config = validateManyChatConfig();
  
  if (!config.isValid) {
    throw new Error(`ManyChat configuration invalid: ${config.missing.join(', ')}`);
  }
  
  return {
    apiKey: getManyChatEnv('API_KEY', { required: true }),
    baseUrl: getManyChatEnv('BASE_URL', { defaultValue: 'https://api.manychat.com' }),
    webhookSecret: getManyChatEnv('WEBHOOK_SECRET')
  };
}