/**
 * ===============================================
 * Merchant Repository - Data Access Layer
 * Repository pattern implementation for merchants
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { withTx } from '../db/index.js';
import type { Sql, SqlFragment } from '../types/sql.js';
import type { DatabaseRow } from '../types/db.js';
// Database access via pg adapter

interface MerchantDbRow extends DatabaseRow {
  id: string;
  business_name: string;
  business_category: string;
  business_description: string | null;
  contact_email: string;
  contact_phone: string | null;
  is_active: boolean;
  subscription_tier: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  monthly_message_limit: string;
  monthly_messages_used: string;
  settings: string;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
  business_account_id: string | null;
  [key: string]: unknown;
}

interface CountRow extends DatabaseRow {
  count: string;
  [key: string]: unknown;
}

interface MerchantStatsRow extends DatabaseRow {
  total_merchants: string;
  active_merchants: string;
  subscription_tier: string | null;
  business_category: string | null;
  total_messages_used: string | null;
  avg_messages_per_merchant: string | null;
  [key: string]: unknown;
}

export interface Merchant {
  id: string;
  businessName: string;
  businessCategory: string;
  businessDescription?: string;
  contactEmail: string;
  contactPhone?: string;
  businessAccountId?: string;
  isActive: boolean;
  subscriptionTier: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  monthlyMessageLimit: number;
  monthlyMessagesUsed: number;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt?: Date;
}

export interface CreateMerchantRequest {
  businessName: string;
  businessCategory: string;
  businessDescription?: string;
  contactEmail: string;
  contactPhone?: string;
  subscriptionTier?: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  businessAccountId?: string;
  monthlyMessageLimit?: number;
  settings?: Record<string, unknown>;
}

export interface UpdateMerchantRequest {
  businessName?: string;
  businessCategory?: string;
  businessDescription?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessAccountId?: string;
  isActive?: boolean;
  subscriptionTier?: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  monthlyMessageLimit?: number;
  settings?: Record<string, unknown>;
}

export interface MerchantFilters {
  isActive?: boolean;
  subscriptionTier?: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  businessCategory?: string;
  searchQuery?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface MerchantStats {
  totalMerchants: number;
  activeMerchants: number;
  bySubscriptionTier: Record<string, number>;
  byBusinessCategory: Record<string, number>;
  totalMessagesUsed: number;
  averageMessagesPerMerchant: number;
}

export interface MerchantCredentials {
  merchantId: string;
  whatsappTokenEncrypted?: string;
  instagramTokenEncrypted?: string;
  instagramPageId?: string;
  businessAccountId?: string; // corresponds to merchant_credentials.business_account_id
  appSecret?: string;
  webhookVerifyToken?: string;
  tokenCreatedIp?: string;
  lastAccessIp?: string;
  lastAccessAt?: Date;
}

export class MerchantRepository {
  private db = getDatabase();

  /**
   * Helper method to safely get first row from SQL result
   */
  private getFirstRow<T>(rows: T[]): T | null {
    return rows.length > 0 ? rows[0]! : null;
  }

  /**
   * Create new merchant
   */
  async create(data: CreateMerchantRequest): Promise<Merchant> {
    const sql: Sql = this.db.getSQL();
    
    const rows = await sql<MerchantDbRow>`
      INSERT INTO merchants (
        business_name,
        business_category,
        business_description,
        contact_email,
        contact_phone,
        subscription_tier,
        monthly_message_limit,
        settings,
        business_account_id
      ) VALUES (
        ${data.businessName},
        ${data.businessCategory},
        ${data.businessDescription || null},
        ${data.contactEmail},
        ${data.contactPhone || null},
        ${data.subscriptionTier || 'FREE'},
        ${data.monthlyMessageLimit || this.getDefaultMessageLimit(data.subscriptionTier || 'FREE')},
        ${JSON.stringify(data.settings || {})},
        ${data.businessAccountId || null}
      )
      RETURNING *
    `;

    const merchant = this.getFirstRow(rows);
    if (!merchant) {
      throw new Error('Failed to create merchant');
    }
    return this.mapToMerchant(merchant);
  }

  /**
   * Find merchant by ID
   */
  async findById(id: string): Promise<Merchant | null> {
    const sql: Sql = this.db.getSQL();
    
    const rows = await sql<MerchantDbRow>`
      SELECT * FROM merchants
      WHERE id = ${id}::uuid
    `;

    const merchant = this.getFirstRow(rows);
    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Find merchant by email
   */
  async findByEmail(email: string): Promise<Merchant | null> {
    const sql: Sql = this.db.getSQL();
    
    const rows = await sql<MerchantDbRow>`
      SELECT * FROM merchants
      WHERE contact_email = ${email}
    `;

    const merchant = this.getFirstRow(rows);
    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Update merchant
   * Note: For production consistency, consider using UnitOfWork for transactional operations
   */
  async update(id: string, data: UpdateMerchantRequest): Promise<Merchant | null> {
    const sql: Sql = this.db.getSQL();
    
    const updateFields: SqlFragment[] = [];

    if (data.businessName !== undefined) {
      updateFields.push(sql`business_name = ${data.businessName}`);
    }

    if (data.businessCategory !== undefined) {
      updateFields.push(sql`business_category = ${data.businessCategory}`);
    }

    if (data.businessDescription !== undefined) {
      updateFields.push(sql`business_description = ${data.businessDescription}`);
    }

    if (data.contactEmail !== undefined) {
      updateFields.push(sql`contact_email = ${data.contactEmail}`);
    }

    if (data.contactPhone !== undefined) {
      updateFields.push(sql`contact_phone = ${data.contactPhone}`);
    }

    if (data.businessAccountId !== undefined) {
      updateFields.push(sql`business_account_id = ${data.businessAccountId}`);
    }

    if (data.isActive !== undefined) {
      updateFields.push(sql`is_active = ${data.isActive}`);
    }

    if (data.subscriptionTier !== undefined) {
      updateFields.push(sql`subscription_tier = ${data.subscriptionTier}`);

      if (data.monthlyMessageLimit === undefined) {
        updateFields.push(sql`monthly_message_limit = ${this.getDefaultMessageLimit(data.subscriptionTier)}`);
      }
    }

    if (data.monthlyMessageLimit !== undefined) {
      updateFields.push(sql`monthly_message_limit = ${data.monthlyMessageLimit}`);
    }

    if (data.settings !== undefined) {
      updateFields.push(sql`settings = ${JSON.stringify(data.settings)}`);
    }

    updateFields.push(sql`updated_at = NOW()`);

    if (updateFields.length === 1) {
      // No actual updates to perform, return existing merchant
      // Note: For consistency with UnitOfWork pattern, consider using transaction context
      return await this.findById(id);
    }

    const [merchant] = await sql<MerchantDbRow>`
      UPDATE merchants
      SET ${(sql as any).join(updateFields, sql`, `)}
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Update last active time
   */
  async updateLastActive(id: string): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    await sql`
      UPDATE merchants
      SET 
        last_active_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}::uuid
    `;
  }

  /**
   * Increment monthly message usage with transaction safety
   */
  async incrementMessageUsage(id: string, count: number = 1): Promise<boolean> {
    if (count <= 0) {
      throw new Error('Message count must be positive');
    }

    if (!id || typeof id !== 'string') {
      throw new Error('Valid merchant ID is required');
    }

    return await withTx(this.db.getPool(), async (client) => {
      // First, check current usage and limit with row locking
      const merchantCheck = await client.query(`
        SELECT 
          monthly_messages_used,
          monthly_message_limit,
          is_active
        FROM merchants 
        WHERE id = $1::uuid 
        FOR UPDATE
      `, [id]);

      if (merchantCheck.rows.length === 0) {
        throw new Error(`Merchant not found: ${id}`);
      }

      const merchant = merchantCheck.rows[0];
      
      if (!merchant.is_active) {
        throw new Error('Merchant account is not active');
      }

      const currentUsage = parseInt(merchant.monthly_messages_used) || 0;
      const limit = parseInt(merchant.monthly_message_limit) || 0;
      
      if (currentUsage + count > limit) {
        throw new Error(`Message limit exceeded: ${currentUsage + count} > ${limit}`);
      }

      // Perform atomic increment
      const result = await client.query(`
        UPDATE merchants
        SET 
          monthly_messages_used = monthly_messages_used + $2,
          updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id, monthly_messages_used
      `, [id, count]);

      if (result.rows.length === 0) {
        throw new Error('Failed to increment message usage');
      }

      // Log successful increment
      const newUsage = parseInt(result.rows[0].monthly_messages_used) || 0;
      console.log(`Message usage incremented for merchant ${id}: ${newUsage}/${limit}`);

      return true;
    });
  }

  /**
   * Reset monthly message usage (for new billing cycle)
   */
  async resetMonthlyUsage(id: string): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    await sql`
      UPDATE merchants
      SET 
        monthly_messages_used = 0,
        updated_at = NOW()
      WHERE id = ${id}::uuid
    `;
  }

  /**
   * Check if merchant can send more messages
   */
  async canSendMessage(id: string): Promise<{ canSend: boolean; remaining: number; limit: number }> {
    const merchant = await this.findById(id);
    
    if (!merchant || !merchant.isActive) {
      return { canSend: false, remaining: 0, limit: 0 };
    }

    const remaining = merchant.monthlyMessageLimit - merchant.monthlyMessagesUsed;
    const canSend = remaining > 0;

    return {
      canSend,
      remaining,
      limit: merchant.monthlyMessageLimit
    };
  }

  /**
   * Find merchants with filters
   */
  async findMany(filters: MerchantFilters = {}): Promise<Merchant[]> {
    const sql: Sql = this.db.getSQL();
    
    const conditions: SqlFragment[] = [];

    if (filters.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    if (filters.subscriptionTier) {
      conditions.push(sql`subscription_tier = ${filters.subscriptionTier}`);
    }

    if (filters.businessCategory) {
      conditions.push(sql`business_category = ${filters.businessCategory}`);
    }

    if (filters.searchQuery) {
      const searchQuery = `%${filters.searchQuery}%`;
      conditions.push(
        sql`(business_name ILIKE ${searchQuery} OR contact_email ILIKE ${searchQuery})`
      );
    }

    if (filters.createdAfter) {
      conditions.push(sql`created_at >= ${filters.createdAfter}`);
    }

    if (filters.createdBefore) {
      conditions.push(sql`created_at <= ${filters.createdBefore}`);
    }

    // const whereClause = conditions.length  // unused
    //   ? sql`WHERE ${(sql as any).join(conditions, sql` AND `)}`
    //   : sql``;
    const limitClause = filters.limit ? sql`LIMIT ${filters.limit}` : sql``;
    const offsetClause = filters.offset ? sql`OFFSET ${filters.offset}` : sql``;

    // Use original template literal approach but properly
    if (conditions.length > 0) {
      const merchants = await sql<MerchantDbRow>`
        SELECT * FROM merchants
        WHERE ${(sql as any).join(conditions, sql` AND `)}
        ORDER BY created_at DESC
        ${limitClause}
        ${offsetClause}
      `;
      return merchants.map((m: MerchantDbRow) => this.mapToMerchant(m));
    } else {
      const merchants = await sql<MerchantDbRow>`
        SELECT * FROM merchants
        ORDER BY created_at DESC
        ${limitClause}
        ${offsetClause}
      `;
      return merchants.map((m: MerchantDbRow) => this.mapToMerchant(m));
    }
  }

  /**
   * Get merchant statistics
   */
  async getStats(): Promise<MerchantStats> {
    const sql: Sql = this.db.getSQL();

    const results = await sql<MerchantStatsRow>`
      SELECT
        COUNT(*) as total_merchants,
        COUNT(*) FILTER (WHERE is_active = true) as active_merchants,
        subscription_tier,
        business_category,
        SUM(monthly_messages_used) as total_messages_used,
        AVG(monthly_messages_used) as avg_messages_per_merchant
      FROM merchants
      GROUP BY ROLLUP(subscription_tier, business_category)
      ORDER BY subscription_tier, business_category
    `;
    
    const stats: MerchantStats = {
      totalMerchants: 0,
      activeMerchants: 0,
      bySubscriptionTier: {},
      byBusinessCategory: {},
      totalMessagesUsed: 0,
      averageMessagesPerMerchant: 0
    };

    for (const row of results) {
      const statsRow = row as MerchantStatsRow;
      if (!statsRow.subscription_tier && !statsRow.business_category) {
        // Overall totals
        stats.totalMerchants = parseInt(statsRow.total_merchants || '0');
        stats.activeMerchants = parseInt(statsRow.active_merchants || '0');
        stats.totalMessagesUsed = parseInt(statsRow.total_messages_used || '0');
        stats.averageMessagesPerMerchant = parseFloat(statsRow.avg_messages_per_merchant || '0');
      } else if (statsRow.subscription_tier && !statsRow.business_category) {
        // Subscription tier totals
        stats.bySubscriptionTier[statsRow.subscription_tier] = parseInt(statsRow.total_merchants || '0');
      } else if (statsRow.subscription_tier && statsRow.business_category) {
        // Business category totals
        if (!statsRow?.business_category) continue;
        const totalMerchants = statsRow.total_merchants;
        if (totalMerchants !== null && totalMerchants !== undefined) {
          const businessCategory = statsRow.business_category;
          if (businessCategory) {
            if (!stats.byBusinessCategory[businessCategory]) {
              stats.byBusinessCategory[businessCategory] = 0;
            }
            stats.byBusinessCategory[businessCategory] += parseInt(String(totalMerchants));
          }
        }
      }
    }

    return stats;
  }

  /**
   * Activate merchant
   */
  async activate(id: string): Promise<boolean> {
    const updated = await this.update(id, { isActive: true });
    return updated !== null;
  }

  /**
   * Deactivate merchant
   */
  async deactivate(id: string): Promise<boolean> {
    const updated = await this.update(id, { isActive: false });
    return updated !== null;
  }

  /**
   * Get merchants approaching message limit
   */
  async getMerchantsApproachingLimit(threshold: number = 0.8): Promise<Merchant[]> {
    const sql: Sql = this.db.getSQL();
    
    const merchants = await sql<MerchantDbRow>`
      SELECT * FROM merchants
      WHERE is_active = true
      AND monthly_messages_used >= (monthly_message_limit * ${threshold})
      AND monthly_messages_used < monthly_message_limit
      ORDER BY (monthly_messages_used::float / monthly_message_limit) DESC
    `;

    return merchants.map((m: MerchantDbRow) => this.mapToMerchant(m));
  }

  /**
   * Get merchants over message limit
   */
  async getMerchantsOverLimit(): Promise<Merchant[]> {
    const sql: Sql = this.db.getSQL();
    
    const merchants = await sql<MerchantDbRow>`
      SELECT * FROM merchants
      WHERE is_active = true
      AND monthly_messages_used >= monthly_message_limit
      ORDER BY monthly_messages_used DESC
    `;

    return merchants.map((m: MerchantDbRow) => this.mapToMerchant(m));
  }

  /**
   * Count merchants with filters
   */
  async count(filters: MerchantFilters = {}): Promise<number> {
    const sql: Sql = this.db.getSQL();
    
    const conditions: SqlFragment[] = [];

    if (filters.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    if (filters.subscriptionTier) {
      conditions.push(sql`subscription_tier = ${filters.subscriptionTier}`);
    }

    if (filters.businessCategory) {
      conditions.push(sql`business_category = ${filters.businessCategory}`);
    }

    const whereClause = conditions.length
      ? sql`WHERE ${(sql as any).join(conditions, sql` AND `)}`
      : sql``;

    const rows = await sql<CountRow>`
      SELECT COUNT(*) as count
      FROM merchants
      ${whereClause}
    `;
    
    const result = this.getFirstRow(rows);
    return result ? parseInt(result.count) : 0;
  }

  /**
   * Get default message limit for subscription tier
   */
  private getDefaultMessageLimit(tier: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE'): number {
    const limits = {
      'FREE': 100,
      'BASIC': 1000,
      'PREMIUM': 5000,
      'ENTERPRISE': 50000
    };
    
    return limits[tier] || limits.FREE;
  }

  /**
   * Map database row to Merchant object
   */
  private mapToMerchant(row: MerchantDbRow): Merchant {
    const merchant: Merchant = {
      id: row.id,
      businessName: row.business_name,
      businessCategory: row.business_category,
      contactEmail: row.contact_email,
      isActive: row.is_active,
      subscriptionTier: row.subscription_tier,
      monthlyMessageLimit: parseInt(row.monthly_message_limit),
      monthlyMessagesUsed: parseInt(row.monthly_messages_used) || 0,
      settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    if (row.business_description) merchant.businessDescription = row.business_description;
    if (row.contact_phone) merchant.contactPhone = row.contact_phone;
    if (row.business_account_id) merchant.businessAccountId = row.business_account_id;
    if (row.last_active_at) merchant.lastActiveAt = new Date(row.last_active_at);
    
    return merchant;
  }
}

// Singleton instance
let merchantRepositoryInstance: MerchantRepository | null = null;

/**
 * Get merchant repository instance
 */
export function getMerchantRepository(): MerchantRepository {
  if (!merchantRepositoryInstance) {
    merchantRepositoryInstance = new MerchantRepository();
  }
  return merchantRepositoryInstance;
}