/**
 * ===============================================
 * Merchant Repository - Data Access Layer
 * Repository pattern implementation for merchants
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import type { Sql } from 'postgres';

export interface Merchant {
  id: string;
  businessName: string;
  businessCategory: string;
  businessDescription?: string;
  contactEmail: string;
  contactPhone?: string;
  isActive: boolean;
  subscriptionTier: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  monthlyMessageLimit: number;
  monthlyMessagesUsed: number;
  settings: Record<string, any>;
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
  monthlyMessageLimit?: number;
  settings?: Record<string, any>;
}

export interface UpdateMerchantRequest {
  businessName?: string;
  businessCategory?: string;
  businessDescription?: string;
  contactEmail?: string;
  contactPhone?: string;
  isActive?: boolean;
  subscriptionTier?: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  monthlyMessageLimit?: number;
  settings?: Record<string, any>;
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
  businessAccountId?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
  tokenCreatedIp?: string;
  lastAccessIp?: string;
  lastAccessAt?: Date;
}

export class MerchantRepository {
  private db = getDatabase();

  /**
   * Create new merchant
   */
  async create(data: CreateMerchantRequest): Promise<Merchant> {
    const sql = this.db.getSQL();
    
    const [merchant] = await sql`
      INSERT INTO merchants (
        business_name,
        business_category,
        business_description,
        contact_email,
        contact_phone,
        subscription_tier,
        monthly_message_limit,
        settings
      ) VALUES (
        ${data.businessName},
        ${data.businessCategory},
        ${data.businessDescription || null},
        ${data.contactEmail},
        ${data.contactPhone || null},
        ${data.subscriptionTier || 'FREE'},
        ${data.monthlyMessageLimit || this.getDefaultMessageLimit(data.subscriptionTier || 'FREE')},
        ${JSON.stringify(data.settings || {})}
      )
      RETURNING *
    `;

    return this.mapToMerchant(merchant);
  }

  /**
   * Find merchant by ID
   */
  async findById(id: string): Promise<Merchant | null> {
    const sql = this.db.getSQL();
    
    const [merchant] = await sql`
      SELECT * FROM merchants
      WHERE id = ${id}::uuid
    `;

    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Find merchant by email
   */
  async findByEmail(email: string): Promise<Merchant | null> {
    const sql = this.db.getSQL();
    
    const [merchant] = await sql`
      SELECT * FROM merchants
      WHERE contact_email = ${email}
    `;

    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Update merchant
   */
  async update(id: string, data: UpdateMerchantRequest): Promise<Merchant | null> {
    const sql = this.db.getSQL();
    
    const updateFields: Sql[] = [];

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
      return await this.findById(id);
    }

    const [merchant] = await this.db.query`
      UPDATE merchants
      SET ${sql.join(updateFields, sql`, `)}
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return merchant ? this.mapToMerchant(merchant) : null;
  }

  /**
   * Update last active time
   */
  async updateLastActive(id: string): Promise<void> {
    const sql = this.db.getSQL();
    
    await sql`
      UPDATE merchants
      SET 
        last_active_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}::uuid
    `;
  }

  /**
   * Increment message usage
   */
  async incrementMessageUsage(id: string, count: number = 1): Promise<boolean> {
    const sql = this.db.getSQL();
    
    const result = await sql`
      UPDATE merchants
      SET 
        monthly_messages_used = monthly_messages_used + ${count},
        updated_at = NOW()
      WHERE id = ${id}::uuid
      AND monthly_messages_used + ${count} <= monthly_message_limit
      RETURNING id
    `;

    return result.length > 0;
  }

  /**
   * Reset monthly message usage (for new billing cycle)
   */
  async resetMonthlyUsage(id: string): Promise<void> {
    const sql = this.db.getSQL();
    
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
    const sql = this.db.getSQL();
    
    const conditions: Sql[] = [];

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

    const whereClause = conditions.length
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;
    const limitClause = filters.limit ? sql`LIMIT ${filters.limit}` : sql``;
    const offsetClause = filters.offset ? sql`OFFSET ${filters.offset}` : sql``;

    const merchants = await this.db.query`
      SELECT * FROM merchants
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
      ${offsetClause}
    `;
    return merchants.map(m => this.mapToMerchant(m));
  }

  /**
   * Get merchant statistics
   */
  async getStats(): Promise<MerchantStats> {
    const sql = this.db.getSQL();
    
    const results = await this.db.query`
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
      if (!row.subscription_tier && !row.business_category) {
        // Overall totals
        stats.totalMerchants = parseInt(row.total_merchants);
        stats.activeMerchants = parseInt(row.active_merchants);
        stats.totalMessagesUsed = parseInt(row.total_messages_used) || 0;
        stats.averageMessagesPerMerchant = parseFloat(row.avg_messages_per_merchant) || 0;
      } else if (row.subscription_tier && !row.business_category) {
        // Subscription tier totals
        stats.bySubscriptionTier[row.subscription_tier] = parseInt(row.total_merchants);
      } else if (row.subscription_tier && row.business_category) {
        // Business category totals
        if (!stats.byBusinessCategory[row.business_category]) {
          stats.byBusinessCategory[row.business_category] = 0;
        }
        stats.byBusinessCategory[row.business_category] += parseInt(row.total_merchants);
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
    const sql = this.db.getSQL();
    
    const merchants = await sql`
      SELECT * FROM merchants
      WHERE is_active = true
      AND monthly_messages_used >= (monthly_message_limit * ${threshold})
      AND monthly_messages_used < monthly_message_limit
      ORDER BY (monthly_messages_used::float / monthly_message_limit) DESC
    `;

    return merchants.map(m => this.mapToMerchant(m));
  }

  /**
   * Get merchants over message limit
   */
  async getMerchantsOverLimit(): Promise<Merchant[]> {
    const sql = this.db.getSQL();
    
    const merchants = await sql`
      SELECT * FROM merchants
      WHERE is_active = true
      AND monthly_messages_used >= monthly_message_limit
      ORDER BY monthly_messages_used DESC
    `;

    return merchants.map(m => this.mapToMerchant(m));
  }

  /**
   * Count merchants with filters
   */
  async count(filters: MerchantFilters = {}): Promise<number> {
    const sql = this.db.getSQL();
    
    const conditions: Sql[] = [];

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
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const [result] = await this.db.query`
      SELECT COUNT(*) as count FROM merchants ${whereClause}
    `;
    
    return parseInt(result.count);
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
  private mapToMerchant(row: any): Merchant {
    return {
      id: row.id,
      businessName: row.business_name,
      businessCategory: row.business_category,
      businessDescription: row.business_description,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      isActive: row.is_active,
      subscriptionTier: row.subscription_tier,
      monthlyMessageLimit: parseInt(row.monthly_message_limit),
      monthlyMessagesUsed: parseInt(row.monthly_messages_used) || 0,
      settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : undefined
    };
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