/**
 * ===============================================
 * Merchant Utilities - AI Sales Platform
 * Centralized merchant ID extraction and validation
 * 
 * ✅ Provides consistent merchant ID extraction
 * ✅ Handles multiple sources (context, headers, query params)
 * ✅ Includes proper error handling
 * ✅ Supports tenant isolation patterns
 * ===============================================
 */

import type { Context } from 'hono';
import { getLogger } from '../services/logger.js';

const logger = getLogger({ component: 'merchant-utils' });

/**
 * Custom error for missing merchant ID
 * Used across the application for consistent error handling
 */
export class MerchantIdMissingError extends Error {
  constructor(message = 'MERCHANT_ID is required but was not provided') {
    super(message);
    this.name = 'MERCHANT_ID_MISSING';
  }
}

/**
 * Extract merchant ID from multiple sources in order of priority:
 * 1. Context merchantId
 * 2. Tenant context merchantId
 * 3. x-merchant-id header
 * 4. merchantId query parameter
 * 
 * @param c - Hono context
 * @param options - Extraction options
 * @returns Merchant ID string
 * @throws MerchantIdMissingError if no merchant ID found
 */
export function requireMerchantId(
  c?: Context, 
  options: {
    strict?: boolean; // Throw error if not found
    fallback?: string; // Fallback value if not found
    logDebug?: boolean; // Log debug information
  } = {}
): string {
  const { strict = true, fallback, logDebug = false } = options;
  
  // Extract from multiple sources in priority order
  const tenantContext = c?.get('tenantContext') as { merchantId?: string } | undefined;
  const merchantId = 
    c?.get('merchantId') ||
    tenantContext?.merchantId ||
    c?.req?.header('x-merchant-id') ||
    c?.req?.query('merchantId');

  if (logDebug) {
    logger.debug('Merchant ID extraction attempt', {
      contextMerchantId: c?.get('merchantId'),
      tenantContextMerchantId: tenantContext?.merchantId,
      headerMerchantId: c?.req?.header('x-merchant-id'),
      queryMerchantId: c?.req?.query('merchantId'),
      finalMerchantId: merchantId || fallback
    });
  }

  if (!merchantId) {
    if (strict) {
      throw new MerchantIdMissingError();
    }
    return fallback ?? '';
  }

  return merchantId;
}

/**
 * Safely extract merchant ID without throwing errors
 * Returns undefined if no merchant ID found
 * 
 * @param c - Hono context
 * @returns Merchant ID string or undefined
 */
export function getMerchantId(c?: Context): string | undefined {
  try {
    return requireMerchantId(c, { strict: false });
  } catch {
    return undefined;
  }
}

/**
 * Validate merchant ID format (UUID)
 * 
 * @param merchantId - Merchant ID to validate
 * @returns True if valid UUID format
 */
export function isValidMerchantId(merchantId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(merchantId);
}

/**
 * Validate and require merchant ID with format checking
 * 
 * @param c - Hono context
 * @returns Valid merchant ID
 * @throws MerchantIdMissingError if missing or invalid
 */
export function requireValidMerchantId(c?: Context): string {
  const merchantId = requireMerchantId(c);
  
  if (!isValidMerchantId(merchantId)) {
    throw new MerchantIdMissingError(`Invalid merchant ID format: ${merchantId}`);
  }
  
  return merchantId;
}

/**
 * Set merchant context in Hono context
 * 
 * @param c - Hono context
 * @param merchantId - Merchant ID to set
 */
export function setMerchantContext(c: Context, merchantId: string): void {
  c.set('merchantId', merchantId);
  
  // Also set in tenant context for compatibility
  const tenantContext = c.get('tenantContext') as Record<string, unknown> || {};
  tenantContext.merchantId = merchantId;
  c.set('tenantContext', tenantContext);
}

/**
 * Clear merchant context from Hono context
 * 
 * @param c - Hono context
 */
export function clearMerchantContext(c: Context): void {
  c.set('merchantId', undefined);
  
  // Also clear from tenant context
  const tenantContext = c.get('tenantContext') as Record<string, unknown> || {};
  delete tenantContext.merchantId;
  c.set('tenantContext', tenantContext);
}