import type { Context } from 'hono';
import { getLogger } from '../services/logger.js';

const logger = getLogger();

export class MerchantIdMissingError extends Error {
  constructor() {
    super('MERCHANT_ID is required but was not provided');
    this.name = 'MERCHANT_ID_MISSING';
  }
}

export function requireMerchantId(c?: Context): string {
  const tenantContext = c?.get('tenantContext') as { merchantId?: string } | undefined;
  const id =
    c?.get('merchantId') ||
    tenantContext?.merchantId ||
    c?.req?.header('x-merchant-id') ||
    c?.req?.query('merchantId');

  if (!id) {
    throw new MerchantIdMissingError();
  }

  logger.debug('Using MERCHANT_ID');
  return id;
}