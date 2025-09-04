import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

type ComplianceStatus = 'SUCCESS' | 'FAILURE' | 'WARNING' | 'INFO';

export class ComplianceService {
  private db = getDatabase();
  private log = getLogger({ component: 'compliance' });

  async logEvent(merchantId: string | null, complianceType: string, status: ComplianceStatus, eventData?: Record<string, unknown>): Promise<void> {
    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO compliance_logs (merchant_id, compliance_type, event_data, status, created_at)
        VALUES (
          ${merchantId ? merchantId : '00000000-0000-0000-0000-000000000000'}::uuid,
          ${complianceType},
          ${eventData ? JSON.stringify(eventData) : JSON.stringify({})}::jsonb,
          ${status},
          NOW()
        )
      `;
    } catch (e) {
      this.log.warn('logEvent failed', { type: complianceType, error: String(e) });
    }
  }

  async logSecurity(merchantId: string | null, category: string, status: ComplianceStatus, details?: Record<string, unknown>): Promise<void> {
    return this.logEvent(merchantId, `SECURITY_${category.toUpperCase()}`, status, details);
  }

  async cleanupExpiredOAuthSessions(): Promise<number> {
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ cleanup_expired_oauth_sessions: number }>`SELECT cleanup_expired_oauth_sessions()`;
      const deleted = Number(rows[0]?.cleanup_expired_oauth_sessions || 0);
      this.log.info('OAuth sessions cleanup executed', { deleted });
      return deleted;
    } catch (e) {
      this.log.warn('cleanupExpiredOAuthSessions failed', { error: String(e) });
      return 0;
    }
  }
}

let complianceInstance: ComplianceService | null = null;
export function getComplianceService(): ComplianceService {
  if (!complianceInstance) complianceInstance = new ComplianceService();
  return complianceInstance;
}

export default ComplianceService;

