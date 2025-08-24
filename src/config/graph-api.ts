/**
 * ===============================================
 * Meta Graph API Configuration (2025 Standards)
 * ✅ Centralized API version and endpoints
 * ===============================================
 */

import { getConfig } from './index.js';

const { instagram } = getConfig();
export const GRAPH_API_VERSION = instagram.apiVersion;
export const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const API_ENDPOINTS = {
  // Instagram Graph API
  IG_USER: (userId: string) => `${GRAPH_API_BASE_URL}/${userId}`,
  IG_MEDIA: (userId: string) => `${GRAPH_API_BASE_URL}/${userId}/media`,
  IG_CONVERSATIONS: (pageId: string) => `${GRAPH_API_BASE_URL}/${pageId}/conversations`,
  IG_MESSAGES: (conversationId: string) => `${GRAPH_API_BASE_URL}/${conversationId}/messages`,
  
  // Instagram Messaging API
  IG_SEND_MESSAGE: (pageId: string) => `${GRAPH_API_BASE_URL}/${pageId}/messages`,
  
  // WhatsApp Business API  
  WA_SEND_MESSAGE: (phoneNumberId: string) => `${GRAPH_API_BASE_URL}/${phoneNumberId}/messages`,
  
  // Debug & Validation
  DEBUG_TOKEN: (token: string) => `${GRAPH_API_BASE_URL}/debug_token?input_token=${token}`,
  
  // Webhooks
  WEBHOOK_SUBSCRIPTION: (appId: string) => `${GRAPH_API_BASE_URL}/${appId}/subscriptions`
} as const;

export type GraphAPIEndpoint = keyof typeof API_ENDPOINTS;

/**
 * Rate limiting headers to monitor
 */
export const RATE_LIMIT_HEADERS = [
  'X-App-Usage',
  'X-Business-Use-Case-Usage', 
  'X-Page-Usage',
  'X-Ads-Usage'
] as const;

/**
 * Rate limiting thresholds (conservative)
 */
export const RATE_LIMITS = {
  APP_USAGE_THRESHOLD: 75, // تحذير عند 75%
  BUSINESS_USAGE_THRESHOLD: 75,
  BACKOFF_BASE_MS: 1000,
  BACKOFF_MAX_MS: 30000,
  JITTER_MS: 500
} as const;