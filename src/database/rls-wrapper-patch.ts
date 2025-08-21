// يجب تطبيق هذه التحديثات على ملف rls-wrapper.ts

// إضافة الدوال الجديدة:

/**
 * Perform admin-level operation with explicit authorization
 */
async adminQuery<T>(
  userId: string,
  callback: (sql: postgres.Sql) => Promise<T>,
  authorized = false
): Promise<T> {
  if (process.env.NODE_ENV === 'production' && !authorized) {
    throw new Error('Admin queries require explicit authorization in production');
  }

  await this.setAdminContext(true, userId, authorized);
  try {
    const sql = this.db.getSQL();
    return await callback(sql);
  } finally {
    await this.clearContext();
  }
}

// تحديث generateSessionId:
private generateSessionId(): string {
  return `rls_${Date.now()}_${crypto.randomUUID()}`;
}

// إضافة logAudit:
private async logAudit(
  action: string,
  userId?: string,
  details: any = {}
): Promise<void> {
  const sql = this.db.getSQL();
  const performedBy = userId ? sql`${userId}::uuid` : null;

  try {
    await sql`INSERT INTO audit_logs (action, entity_type, details, performed_by)
              VALUES (${action}, 'rls', ${sql.json(details)}, ${performedBy})`;
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

// تحديث getRawDatabase:
getRawDatabase(userId?: string, authorized = false) {
  if (process.env.NODE_ENV === 'production' && !authorized) {
    throw new Error('getRawDatabase is restricted in production');
  }

  console.warn('⚠️ Getting raw database connection - RLS bypassed!');
  void this.logAudit('get_raw_database', userId, { authorized });
  return this.db;
}

// تحديث withAdminContext:
export async function withAdminContext<T>(
  userId: string,
  callback: (db: RLSDatabase) => Promise<T>,
  authorized = false
): Promise<T> {
  if (process.env.NODE_ENV === 'production' && !authorized) {
    throw new Error('Admin context requires explicit authorization in production');
  }

  const db = getRLSDatabase();
  const originalContext = db.getCurrentContext();

  try {
    await db.setAdminContext(true, userId, authorized);
    return await callback(db);
  } finally {
    // استرجاع السياق الأصلي
    if (originalContext.merchantId) {
      await db.setMerchantContext(originalContext.merchantId);
    } else if (originalContext.isAdmin) {
      await db.setAdminContext(
        originalContext.isAdmin,
        originalContext.userId,
        true
      );
    } else {
      await db.clearContext();
    }
  }
}