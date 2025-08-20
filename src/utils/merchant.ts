import type { Context } from 'hono';

export class MerchantIdMissingError extends Error {
  constructor() {
    super('MERCHANT_ID is required but was not provided');
    this.name = 'MERCHANT_ID_MISSING';
  }
}

export function requireMerchantId(c?: Context): string {
  const id = c?.get('merchantId') || c?.req?.query('merchantId') || process.env.MERCHANT_ID;

  if (!id) {
    throw new MerchantIdMissingError();
  }

  console.log(`Using MERCHANT_ID: ${id}`);
  return id;
}