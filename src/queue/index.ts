/**
 * ===============================================
 * Queue Index - Export Queue Functions
 * ===============================================
 */

// Export queue functions
export { getDatabaseJobSpool } from './db-spool.js';

// Export types
export interface InstagramWebhookJob {
  merchantId: string;
  payload: {
    object: string;
    entry: Array<{
      id: string;
      time: number;
      messaging?: unknown[];
      comments?: unknown[];
      mentions?: unknown[];
    }>;
  };
  signature: string;
  timestamp: Date;
  headers: Record<string, string>;
}

// Export queue utilities
export { withTenantJob } from './withTenantJob.js';
