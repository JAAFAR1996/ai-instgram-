/**
 * Internal Route Security - /internal/* endpoints protection
 * IP allowlist + auth tokens for administrative endpoints
 */

import { Context, Next } from 'hono';
import { getLogger } from '../services/logger.js';
import crypto from 'crypto';

const logger = getLogger({ component: 'InternalAuth' });

/**
 * Get trusted client IP address with proxy validation
 */
function getTrustedClientIP(c: Context, trustedProxies: string[]): string {
  const remoteAddress = c.req.header('x-real-ip') || 'unknown';
  const forwardedFor = c.req.header('x-forwarded-for');
  
  if (forwardedFor && trustedProxies.includes(remoteAddress)) {
    const firstIP = forwardedFor.split(',')[0];
    return firstIP ? firstIP.trim() : remoteAddress;
  }
  
  return remoteAddress;
}

export interface InternalAuthConfig {
  enabled: boolean;
  allowedIPs: string[];
  authToken: string | null;
  logAllAttempts: boolean;
}

const DEFAULT_CONFIG: InternalAuthConfig = {
  enabled: process.env.NODE_ENV === 'production',
  allowedIPs: ['127.0.0.1', '::1'],
  authToken: process.env.INTERNAL_AUTH_TOKEN || null,
  logAllAttempts: true
};

export function createInternalAuthMiddleware(config: Partial<InternalAuthConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    
    if (!path.startsWith('/internal/')) {
      return await next();
    }

    if (!finalConfig.enabled) {
      logger.warn('Internal auth DISABLED');
      return await next();
    }

    const trustedProxies = process.env.TRUSTED_PROXY_IPS?.split(',') || ['127.0.0.1'];
    const clientIP = getTrustedClientIP(c, trustedProxies);
    
    if (finalConfig.logAllAttempts) {
      logger.info('Internal route access attempt', { path, ip: clientIP });
    }

    // IP allowlist check
    if (!finalConfig.allowedIPs.includes('*') && !finalConfig.allowedIPs.includes(clientIP)) {
      logger.error('Internal route access DENIED', { ip: clientIP, path });
      return c.json({ error: 'Access denied', code: 'IP_NOT_ALLOWED' }, 403);
    }

    // Auth token check if configured
    if (finalConfig.authToken) {
      const authHeader = c.req.header('authorization');
      if (!authHeader) {
        return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
      }

      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(finalConfig.authToken))) {
        logger.error('Internal route invalid token', { ip: clientIP, path });
        return c.json({ error: 'Invalid token', code: 'INVALID_TOKEN' }, 401);
      }
    }

    logger.info('Internal route access granted', { ip: clientIP, path });
    return await next();
  };
}

export default createInternalAuthMiddleware;