import { getDatabase } from '../../db/adapter.js';

// Allowed actions per audit_logs constraint (042 migration)
export type AuditAction =
  | 'API_CALL'
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'WEBHOOK_RECEIVED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_RECEIVED'
  | 'INSTAGRAM_AUTH'
  | 'WHATSAPP_AUTH'
  | 'SYSTEM_EVENT';

function normalizeAction(a?: string): AuditAction {
  const x = (a || '').toUpperCase();
  switch (x) {
    case 'PLATFORM_INTERACTION':
    case 'PLATFORM_LOG':
    case 'CALL':
      return 'API_CALL';
    case 'MESSAGE_SENT':
      return 'MESSAGE_SENT';
    case 'MESSAGE_READ':
      return 'READ';
    case 'WRITE':
    case 'INSERT':
      return 'CREATE';
    case 'UPDATE':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    case 'LOGIN':
      return 'LOGIN';
    case 'LOGOUT':
      return 'LOGOUT';
    case 'ERROR':
      return 'SYSTEM_EVENT';
    default:
      return 'API_CALL';
  }
}

export async function logPlatformInteraction(opts: {
  actorId?: string;
  merchantId?: string;
  action: string;
  payload?: unknown;
  resourceId?: string | null;
}): Promise<void> {
  const db = getDatabase();
  const sql = db.getSQL();
  const action = normalizeAction(opts.action);
  const details = opts.payload ? JSON.stringify(opts.payload) : null;
  // Use resource_type = 'SYSTEM' to satisfy constraint and DEFAULT
  await sql`
    INSERT INTO audit_logs (
      merchant_id,
      user_id,
      action,
      resource_type,
      resource_id,
      details,
      status,
      created_at
    ) VALUES (
      ${opts.merchantId ?? null}::uuid,
      ${opts.actorId ?? null},
      ${action},
      'SYSTEM',
      ${opts.resourceId ?? null},
      ${details},
      'SUCCESS',
      NOW()
    )
  `;
}

