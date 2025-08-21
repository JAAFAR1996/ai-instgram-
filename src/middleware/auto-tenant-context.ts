/**
 * ===============================================
 * Auto Tenant Context Middleware - Security Hardened
 * Critical: Never consumes body, always clears context
 * ===============================================
 */

import { Context, Next } from 'hono';
import { getRLSDatabase } from '../database/rls-wrapper.js';
import { getEncryptionService } from '../services/encryption.js';
import jwt from 'jsonwebtoken';

export interface TenantContext {
  merchantId?: string;
  userId?: string;
  isAdmin?: boolean;
  source?: string;
}

export interface TenantContextConfig {
  enableAutoContext?: boolean;
  headerName?: string;
  cookieName?: string;
  jwtSecret?: string;        // HS256 only; prefer RS256 via JWKS if available
  jwtIssuer?: string;
  jwtAudience?: string;
  adminRoles?: string[];
  skipPaths?: string[];
  allowedAlgs?: jwt.Algorithm[]; // default: ['HS256','RS256']
}

function getDefaultConfig(): TenantContextConfig {
  return {
    enableAutoContext: true,
    headerName: 'x-merchant-id',
    cookieName: 'merchant_id',
    jwtSecret:
      process.env.JWT_SECRET ??
      (() => {
        throw new Error('JWT_SECRET is required');
      })(),
    jwtIssuer: process.env.JWT_ISSUER || undefined,
    jwtAudience: process.env.JWT_AUDIENCE || undefined,
    adminRoles: ['admin', 'super_admin'],
    skipPaths: ['/health', '/webhooks', '/public', '/metrics'],
    allowedAlgs: ['HS256', 'RS256'],
  };
}

export function autoTenantContext(cfg: TenantContextConfig = {}) {
  let opts: TenantContextConfig;
  try {
    opts = { ...getDefaultConfig(), ...cfg };
  } catch (err) {
    return async (c: Context, next: Next) =>
      c.json(
        {
          error: 'Failed to initialize tenant context',
          details: err instanceof Error ? err.message : 'JWT secret missing',
        },
        500,
      );
  }

  return async (c: Context, next: Next) => {
    const path = c.req.path;
    if (opts.skipPaths?.some(sp => path.startsWith(sp))) return next();

    const rlsDb = getRLSDatabase();
    let contextSet = false;

    try {
      const tenant = await extractTenantInfo(c, opts);

      if (tenant.merchantId) {
        await rlsDb.setMerchantContext(tenant.merchantId, tenant.userId);
        c.set('tenantContext', tenant as TenantContext);
        contextSet = true;
      } else if (tenant.isAdmin) {
        await rlsDb.setAdminContext(true, tenant.userId, true);
        c.set('tenantContext', tenant as TenantContext);
        contextSet = true;
      } else {
        // For JSON APIs, require context; for others, just proceed.
        if ((c.req.header('content-type') ?? '').includes('application/json')) {
          return c.json({ error: 'Missing tenant context' }, 401);
        }
      }

      await next();
    } catch (err) {
        await rlsDb.clearContext().catch((e) => {
          console.error('Failed to clear tenant context:', e);
        });
      return c.json({
        error: 'Failed to establish tenant context',
        details: err instanceof Error ? err.message : 'Unknown error',
      }, 500);
    } finally {
      if (contextSet) {
          await rlsDb.clearContext().catch((e) => {
            console.error('Failed to clear tenant context:', e);
          }); // critical: prevent tenant bleed with pooled connections
        }
    }
  };
}

async function extractTenantInfo(
  c: Context,
  config: TenantContextConfig
): Promise<TenantContext & { source: string }> {
  // 1) Header
  const hdr = c.req.header(config.headerName!);
  if (hdr && isValidUUID(hdr)) return { merchantId: hdr, source: 'header' };

  // 2) JWT - Security hardened
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, config.jwtSecret || 'unused', {
        algorithms: config.allowedAlgs,
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        clockTolerance: 30, // seconds
      }) as any;

      const isAdmin = !!payload?.roles?.some((r: string) => config.adminRoles?.includes(r));
      const merchantId = payload.merchantId || payload.merchant_id;
      if (merchantId && !isValidUUID(merchantId)) {
        return { isAdmin, userId: payload.sub, source: 'jwt' };
      }
      return {
        merchantId,
        userId: payload.userId || payload.user_id || payload.sub,
        isAdmin,
        source: 'jwt',
      };
    } catch {
      // No JWT details in logs for security
    }
  }

  // 3) Encrypted cookie - Robust parsing
  const cookieHeader = c.req.header('cookie') || '';
  const m = cookieHeader.match(new RegExp(`${config.cookieName}=([^;]+)`));
  if (m) {
    try {
      const encryption = getEncryptionService();
      const decrypted = encryption.decrypt(JSON.parse(decodeURIComponent(m[1])));
      const data = JSON.parse(decrypted);
      if (data.merchantId && isValidUUID(data.merchantId)) {
        return { merchantId: data.merchantId, userId: data.userId, source: 'cookie' };
      }
    } catch {
      // No cookie parsing errors in logs
    }
  }

  // 4) Webhooks: NEVER consume body here - context set in webhook handler after signature verification
  if (c.req.path.includes('/webhooks/')) {
    return { source: 'webhook' };
  }

  return { source: 'none' };
}

function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Middleware to require tenant context
 */
export function requireTenantContext() {
  return async (c: Context, next: Next) => {
    const tenantContext = c.get('tenantContext') as TenantContext | undefined;
    
    if (!tenantContext || (!tenantContext.merchantId && !tenantContext.isAdmin)) {
      return c.json({
        error: 'Tenant context required',
        message: 'This endpoint requires a valid merchant context or admin privileges'
      }, 401);
    }

    await next();
  };
}

/**
 * Middleware to require admin context
 */
export function requireAdminContext() {
  return async (c: Context, next: Next) => {
    const tenantContext = c.get('tenantContext') as TenantContext | undefined;
    
    if (!tenantContext?.isAdmin) {
      return c.json({
        error: 'Admin privileges required',
        message: 'This endpoint requires admin privileges'
      }, 403);
    }

    await next();
  };
}

/**
 * Get current tenant context from request
 */
export function getTenantContext(c: Context): TenantContext | undefined {
  return c.get('tenantContext') as TenantContext | undefined;
}

export default autoTenantContext;