/**
 * ===============================================
 * Merchant Repository Tests - اختبارات شاملة لمستودع التجار
 * Production-grade tests for merchant data access layer
 * ===============================================
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MerchantRepository, type Merchant, type CreateMerchantRequest, type UpdateMerchantRequest } from './merchant-repository.js';
import { initializeDatabase } from '../database/connection.js';

const TEST_MERCHANT_BASE_ID = 'merchant-repo-test';
let testMerchantCounter = 0;

describe('MerchantRepository - Production Tests', () => {
  let repository: MerchantRepository;
  let db: any;
  let sql: any;
  let testMerchants: string[] = [];

  beforeAll(async () => {
    // Initialize database and repository
    db = await initializeDatabase();
    sql = db.getSQL();
    repository = new MerchantRepository();
  });

  beforeEach(async () => {
    // Clean up any existing test merchants
    if (testMerchants.length > 0) {
      await sql`DELETE FROM merchants WHERE id = ANY(${testMerchants.map(id => `${id}::uuid`)})`;
      testMerchants = [];
    }
  });

  afterAll(async () => {
    // Final cleanup
    if (testMerchants.length > 0) {
      await sql`DELETE FROM merchants WHERE id = ANY(${testMerchants.map(id => `${id}::uuid`)})`;
    }
  });

  // Helper function to generate unique test merchant ID
  const generateTestMerchantId = (): string => {
    const id = `${TEST_MERCHANT_BASE_ID}-${Date.now()}-${++testMerchantCounter}`;
    testMerchants.push(id);
    return id;
  };

  describe('create() - Merchant Creation Tests', () => {
    test('should create new merchant with valid data', async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Test Fashion Store',
        businessCategory: 'fashion',
        businessDescription: 'A modern fashion store specializing in Iraqi traditional wear',
        contactEmail: 'owner@testfashion.com',
        contactPhone: '+9647701234567',
        subscriptionTier: 'BASIC',
        monthlyMessageLimit: 1000,
        settings: {
          timezone: 'Asia/Baghdad',
          language: 'ar',
          autoReply: true
        }
      };

      const merchant = await repository.create(merchantData);

      expect(merchant).toBeDefined();
      expect(merchant.id).toBeDefined();
      expect(merchant.businessName).toBe(merchantData.businessName);
      expect(merchant.businessCategory).toBe(merchantData.businessCategory);
      expect(merchant.contactEmail).toBe(merchantData.contactEmail);
      expect(merchant.subscriptionTier).toBe('BASIC');
      expect(merchant.monthlyMessageLimit).toBe(1000);
      expect(merchant.monthlyMessagesUsed).toBe(0);
      expect(merchant.settings.timezone).toBe('Asia/Baghdad');
      expect(merchant.isActive).toBe(true);
      expect(merchant.createdAt).toBeInstanceOf(Date);
      expect(merchant.updatedAt).toBeInstanceOf(Date);

      testMerchants.push(merchant.id);
    });

    test('should create merchant with default values', async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Minimal Test Store',
        businessCategory: 'electronics',
        contactEmail: 'minimal@test.com'
      };

      const merchant = await repository.create(merchantData);

      expect(merchant.subscriptionTier).toBe('FREE');
      expect(merchant.monthlyMessageLimit).toBe(100); // Default for FREE tier
      expect(merchant.settings).toEqual({});
      expect(merchant.businessDescription).toBeUndefined();
      expect(merchant.contactPhone).toBeUndefined();

      testMerchants.push(merchant.id);
    });

    test('should handle Arabic business names correctly', async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'متجر الأزياء العراقية',
        businessCategory: 'fashion',
        contactEmail: 'arabic@store.com',
        businessDescription: 'متجر متخصص في الأزياء التراثية العراقية'
      };

      const merchant = await repository.create(merchantData);

      expect(merchant.businessName).toBe('متجر الأزياء العراقية');
      expect(merchant.businessDescription).toBe('متجر متخصص في الأزياء التراثية العراقية');

      testMerchants.push(merchant.id);
    });

    test('should reject duplicate email addresses', async () => {
      const email = 'duplicate@test.com';
      
      const merchantData1: CreateMerchantRequest = {
        businessName: 'First Store',
        businessCategory: 'fashion',
        contactEmail: email
      };

      const merchantData2: CreateMerchantRequest = {
        businessName: 'Second Store',
        businessCategory: 'electronics',
        contactEmail: email
      };

      const merchant1 = await repository.create(merchantData1);
      testMerchants.push(merchant1.id);

      await expect(repository.create(merchantData2)).rejects.toThrow();
    });
  });

  describe('findById() - Merchant Retrieval Tests', () => {
    test('should find existing merchant by ID', async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Findable Store',
        businessCategory: 'food',
        contactEmail: 'findable@test.com'
      };

      const created = await repository.create(merchantData);
      testMerchants.push(created.id);

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.businessName).toBe(merchantData.businessName);
      expect(found!.contactEmail).toBe(merchantData.contactEmail);
    });

    test('should return null for non-existent merchant ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      
      const result = await repository.findById(nonExistentId);

      expect(result).toBeNull();
    });

    test('should handle invalid UUID format gracefully', async () => {
      const invalidId = 'not-a-valid-uuid';
      
      await expect(repository.findById(invalidId)).rejects.toThrow();
    });
  });

  describe('findByEmail() - Email-based Retrieval Tests', () => {
    test('should find merchant by email address', async () => {
      const email = 'email-search@test.com';
      const merchantData: CreateMerchantRequest = {
        businessName: 'Email Searchable Store',
        businessCategory: 'services',
        contactEmail: email
      };

      const created = await repository.create(merchantData);
      testMerchants.push(created.id);

      const found = await repository.findByEmail(email);

      expect(found).toBeDefined();
      expect(found!.contactEmail).toBe(email);
      expect(found!.id).toBe(created.id);
    });

    test('should return null for non-existent email', async () => {
      const result = await repository.findByEmail('nonexistent@test.com');

      expect(result).toBeNull();
    });

    test('should be case insensitive for email search', async () => {
      const email = 'CaseTest@Example.Com';
      const merchantData: CreateMerchantRequest = {
        businessName: 'Case Test Store',
        businessCategory: 'fashion',
        contactEmail: email.toLowerCase()
      };

      const created = await repository.create(merchantData);
      testMerchants.push(created.id);

      const found = await repository.findByEmail(email.toUpperCase());

      expect(found).toBeDefined();
      expect(found!.contactEmail).toBe(email.toLowerCase());
    });
  });

  describe('update() - Merchant Update Tests', () => {
    let testMerchant: Merchant;

    beforeEach(async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Updatable Store',
        businessCategory: 'fashion',
        contactEmail: 'updatable@test.com',
        subscriptionTier: 'FREE',
        settings: { theme: 'light' }
      };

      testMerchant = await repository.create(merchantData);
      testMerchants.push(testMerchant.id);
    });

    test('should update business information', async () => {
      const updateData: UpdateMerchantRequest = {
        businessName: 'Updated Store Name',
        businessDescription: 'New description',
        contactPhone: '+9647709876543'
      };

      const updated = await repository.update(testMerchant.id, updateData);

      expect(updated).toBeDefined();
      expect(updated!.businessName).toBe(updateData.businessName);
      expect(updated!.businessDescription).toBe(updateData.businessDescription);
      expect(updated!.contactPhone).toBe(updateData.contactPhone);
      expect(updated!.contactEmail).toBe(testMerchant.contactEmail); // Unchanged
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(testMerchant.updatedAt.getTime());
    });

    test('should update subscription tier and auto-adjust message limit', async () => {
      const updateData: UpdateMerchantRequest = {
        subscriptionTier: 'PREMIUM'
      };

      const updated = await repository.update(testMerchant.id, updateData);

      expect(updated!.subscriptionTier).toBe('PREMIUM');
      expect(updated!.monthlyMessageLimit).toBe(5000); // Default for PREMIUM
    });

    test('should update subscription tier with custom message limit', async () => {
      const updateData: UpdateMerchantRequest = {
        subscriptionTier: 'ENTERPRISE',
        monthlyMessageLimit: 75000
      };

      const updated = await repository.update(testMerchant.id, updateData);

      expect(updated!.subscriptionTier).toBe('ENTERPRISE');
      expect(updated!.monthlyMessageLimit).toBe(75000); // Custom limit
    });

    test('should update settings while preserving existing keys', async () => {
      const updateData: UpdateMerchantRequest = {
        settings: {
          theme: 'dark',
          notifications: true
        }
      };

      const updated = await repository.update(testMerchant.id, updateData);

      expect(updated!.settings.theme).toBe('dark');
      expect(updated!.settings.notifications).toBe(true);
    });

    test('should activate/deactivate merchant', async () => {
      // Deactivate
      let updated = await repository.update(testMerchant.id, { isActive: false });
      expect(updated!.isActive).toBe(false);

      // Reactivate
      updated = await repository.update(testMerchant.id, { isActive: true });
      expect(updated!.isActive).toBe(true);
    });

    test('should return null for non-existent merchant', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      
      const result = await repository.update(nonExistentId, { businessName: 'Test' });

      expect(result).toBeNull();
    });

    test('should handle empty update gracefully', async () => {
      const result = await repository.update(testMerchant.id, {});

      expect(result).toBeDefined();
      expect(result!.id).toBe(testMerchant.id);
      expect(result!.updatedAt.getTime()).toBeGreaterThan(testMerchant.updatedAt.getTime());
    });
  });

  describe('Message Usage Tracking Tests', () => {
    let testMerchant: Merchant;

    beforeEach(async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Usage Test Store',
        businessCategory: 'fashion',
        contactEmail: 'usage@test.com',
        subscriptionTier: 'BASIC',
        monthlyMessageLimit: 100
      };

      testMerchant = await repository.create(merchantData);
      testMerchants.push(testMerchant.id);
    });

    test('should increment message usage successfully', async () => {
      const success = await repository.incrementMessageUsage(testMerchant.id, 5);

      expect(success).toBe(true);

      const updated = await repository.findById(testMerchant.id);
      expect(updated!.monthlyMessagesUsed).toBe(5);
    });

    test('should prevent exceeding message limit', async () => {
      // First, use up most of the limit
      await repository.incrementMessageUsage(testMerchant.id, 95);

      // Try to exceed the limit
      const success = await repository.incrementMessageUsage(testMerchant.id, 10);

      expect(success).toBe(false);

      const merchant = await repository.findById(testMerchant.id);
      expect(merchant!.monthlyMessagesUsed).toBe(95); // Should remain unchanged
    });

    test('should allow usage exactly at the limit', async () => {
      const success = await repository.incrementMessageUsage(testMerchant.id, 100);

      expect(success).toBe(true);

      const merchant = await repository.findById(testMerchant.id);
      expect(merchant!.monthlyMessagesUsed).toBe(100);
    });

    test('should reset monthly usage', async () => {
      // First increment usage
      await repository.incrementMessageUsage(testMerchant.id, 50);

      // Reset usage
      await repository.resetMonthlyUsage(testMerchant.id);

      const merchant = await repository.findById(testMerchant.id);
      expect(merchant!.monthlyMessagesUsed).toBe(0);
    });

    test('should check if merchant can send message', async () => {
      // Initially should be able to send
      let canSend = await repository.canSendMessage(testMerchant.id);
      expect(canSend.canSend).toBe(true);
      expect(canSend.remaining).toBe(100);
      expect(canSend.limit).toBe(100);

      // After using some messages
      await repository.incrementMessageUsage(testMerchant.id, 75);

      canSend = await repository.canSendMessage(testMerchant.id);
      expect(canSend.canSend).toBe(true);
      expect(canSend.remaining).toBe(25);

      // After reaching limit
      await repository.incrementMessageUsage(testMerchant.id, 25);

      canSend = await repository.canSendMessage(testMerchant.id);
      expect(canSend.canSend).toBe(false);
      expect(canSend.remaining).toBe(0);
    });

    test('should handle inactive merchant in canSendMessage', async () => {
      // Deactivate merchant
      await repository.update(testMerchant.id, { isActive: false });

      const canSend = await repository.canSendMessage(testMerchant.id);

      expect(canSend.canSend).toBe(false);
      expect(canSend.remaining).toBe(0);
      expect(canSend.limit).toBe(0);
    });
  });

  describe('updateLastActive() - Activity Tracking Tests', () => {
    test('should update last active timestamp', async () => {
      const merchantData: CreateMerchantRequest = {
        businessName: 'Activity Test Store',
        businessCategory: 'electronics',
        contactEmail: 'activity@test.com'
      };

      const merchant = await repository.create(merchantData);
      testMerchants.push(merchant.id);

      const initialLastActive = merchant.lastActiveAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      await repository.updateLastActive(merchant.id);

      const updated = await repository.findById(merchant.id);
      expect(updated!.lastActiveAt).toBeDefined();
      expect(updated!.lastActiveAt!.getTime()).toBeGreaterThan(
        initialLastActive?.getTime() || 0
      );
    });
  });

  describe('findMany() - Filtered Retrieval Tests', () => {
    beforeEach(async () => {
      // Create test merchants with different characteristics
      const merchants = [
        {
          businessName: 'Active Fashion Store',
          businessCategory: 'fashion',
          contactEmail: 'active.fashion@test.com',
          subscriptionTier: 'PREMIUM' as const,
          isActive: true
        },
        {
          businessName: 'Inactive Electronics Store',
          businessCategory: 'electronics',
          contactEmail: 'inactive.electronics@test.com',
          subscriptionTier: 'BASIC' as const,
          isActive: false
        },
        {
          businessName: 'Free Food Store',
          businessCategory: 'food',
          contactEmail: 'free.food@test.com',
          subscriptionTier: 'FREE' as const
        }
      ];

      for (const merchantData of merchants) {
        const created = await repository.create(merchantData);
        testMerchants.push(created.id);
        
        if (!merchantData.isActive) {
          await repository.update(created.id, { isActive: false });
        }
      }
    });

    test('should filter by subscription tier', async () => {
      const premiumMerchants = await repository.findMany({ subscriptionTier: 'PREMIUM' });

      expect(premiumMerchants.length).toBeGreaterThan(0);
      premiumMerchants.forEach(merchant => {
        expect(merchant.subscriptionTier).toBe('PREMIUM');
      });
    });

    test('should filter by active status', async () => {
      const activeMerchants = await repository.findMany({ isActive: true });
      const inactiveMerchants = await repository.findMany({ isActive: false });

      expect(activeMerchants.length).toBeGreaterThan(0);
      expect(inactiveMerchants.length).toBeGreaterThan(0);

      activeMerchants.forEach(merchant => {
        expect(merchant.isActive).toBe(true);
      });

      inactiveMerchants.forEach(merchant => {
        expect(merchant.isActive).toBe(false);
      });
    });

    test('should filter by business category', async () => {
      const fashionMerchants = await repository.findMany({ businessCategory: 'fashion' });

      expect(fashionMerchants.length).toBeGreaterThan(0);
      fashionMerchants.forEach(merchant => {
        expect(merchant.businessCategory).toBe('fashion');
      });
    });

    test('should search by business name and email', async () => {
      const searchResults = await repository.findMany({ searchQuery: 'fashion' });

      expect(searchResults.length).toBeGreaterThan(0);
      searchResults.forEach(merchant => {
        const matchesName = merchant.businessName.toLowerCase().includes('fashion');
        const matchesEmail = merchant.contactEmail.toLowerCase().includes('fashion');
        expect(matchesName || matchesEmail).toBe(true);
      });
    });

    test('should apply limit and offset pagination', async () => {
      const page1 = await repository.findMany({ limit: 2, offset: 0 });
      const page2 = await repository.findMany({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);

      // Ensure no duplicate merchants between pages
      const page1Ids = new Set(page1.map(m => m.id));
      const page2Ids = new Set(page2.map(m => m.id));
      const intersection = new Set([...page1Ids].filter(id => page2Ids.has(id)));
      expect(intersection.size).toBe(0);
    });

    test('should combine multiple filters', async () => {
      const results = await repository.findMany({
        subscriptionTier: 'BASIC',
        isActive: false,
        businessCategory: 'electronics'
      });

      results.forEach(merchant => {
        expect(merchant.subscriptionTier).toBe('BASIC');
        expect(merchant.isActive).toBe(false);
        expect(merchant.businessCategory).toBe('electronics');
      });
    });
  });

  describe('Usage Limit Analysis Tests', () => {
    beforeEach(async () => {
      // Create merchants with different usage patterns
      const merchantsData = [
        { name: 'High Usage Store', limit: 100, used: 85 }, // 85% usage
        { name: 'Medium Usage Store', limit: 100, used: 60 }, // 60% usage
        { name: 'Over Limit Store', limit: 100, used: 105 }, // Over limit
        { name: 'Low Usage Store', limit: 100, used: 20 } // 20% usage
      ];

      for (const data of merchantsData) {
        const merchant = await repository.create({
          businessName: data.name,
          businessCategory: 'test',
          contactEmail: `${data.name.replace(/\s+/g, '').toLowerCase()}@test.com`,
          monthlyMessageLimit: data.limit
        });
        
        testMerchants.push(merchant.id);

        // Manually set usage in database
        await sql`
          UPDATE merchants 
          SET monthly_messages_used = ${data.used}
          WHERE id = ${merchant.id}::uuid
        `;
      }
    });

    test('should find merchants approaching limit', async () => {
      const approaching = await repository.getMerchantsApproachingLimit(0.8); // 80% threshold

      expect(approaching.length).toBeGreaterThan(0);
      approaching.forEach(merchant => {
        const usagePercent = merchant.monthlyMessagesUsed / merchant.monthlyMessageLimit;
        expect(usagePercent).toBeGreaterThanOrEqual(0.8);
        expect(usagePercent).toBeLessThan(1.0);
      });
    });

    test('should find merchants over limit', async () => {
      const overLimit = await repository.getMerchantsOverLimit();

      expect(overLimit.length).toBeGreaterThan(0);
      overLimit.forEach(merchant => {
        expect(merchant.monthlyMessagesUsed).toBeGreaterThanOrEqual(merchant.monthlyMessageLimit);
      });
    });

    test('should use custom threshold for approaching limit', async () => {
      const conservative = await repository.getMerchantsApproachingLimit(0.5); // 50% threshold
      const aggressive = await repository.getMerchantsApproachingLimit(0.9); // 90% threshold

      expect(conservative.length).toBeGreaterThanOrEqual(aggressive.length);
    });
  });

  describe('Statistics and Analytics Tests', () => {
    beforeEach(async () => {
      // Create diverse test data for statistics
      const testData = [
        { tier: 'FREE', category: 'fashion', active: true, used: 50 },
        { tier: 'BASIC', category: 'fashion', active: true, used: 300 },
        { tier: 'PREMIUM', category: 'electronics', active: true, used: 1500 },
        { tier: 'FREE', category: 'food', active: false, used: 10 },
        { tier: 'ENTERPRISE', category: 'services', active: true, used: 5000 }
      ];

      for (const data of testData) {
        const merchant = await repository.create({
          businessName: `${data.tier} ${data.category} Store`,
          businessCategory: data.category,
          contactEmail: `${data.tier}.${data.category}@test.com`,
          subscriptionTier: data.tier as any
        });

        testMerchants.push(merchant.id);

        // Update active status and usage
        await repository.update(merchant.id, { isActive: data.active });
        await sql`
          UPDATE merchants 
          SET monthly_messages_used = ${data.used}
          WHERE id = ${merchant.id}::uuid
        `;
      }
    });

    test('should generate comprehensive statistics', async () => {
      const stats = await repository.getStats();

      expect(stats.totalMerchants).toBeGreaterThan(0);
      expect(stats.activeMerchants).toBeGreaterThan(0);
      expect(stats.activeMerchants).toBeLessThanOrEqual(stats.totalMerchants);

      // Check subscription tier breakdown
      expect(Object.keys(stats.bySubscriptionTier).length).toBeGreaterThan(0);
      expect(stats.bySubscriptionTier.FREE).toBeGreaterThan(0);

      // Check business category breakdown
      expect(Object.keys(stats.byBusinessCategory).length).toBeGreaterThan(0);
      expect(stats.byBusinessCategory.fashion).toBeGreaterThan(0);

      // Check message usage stats
      expect(stats.totalMessagesUsed).toBeGreaterThan(0);
      expect(stats.averageMessagesPerMerchant).toBeGreaterThan(0);
    });

    test('should count merchants with filters', async () => {
      const totalCount = await repository.count();
      const activeCount = await repository.count({ isActive: true });
      const fashionCount = await repository.count({ businessCategory: 'fashion' });

      expect(totalCount).toBeGreaterThan(0);
      expect(activeCount).toBeGreaterThan(0);
      expect(activeCount).toBeLessThanOrEqual(totalCount);
      expect(fashionCount).toBeGreaterThan(0);
      expect(fashionCount).toBeLessThanOrEqual(totalCount);
    });
  });

  describe('Activation/Deactivation Helper Tests', () => {
    let testMerchant: Merchant;

    beforeEach(async () => {
      testMerchant = await repository.create({
        businessName: 'Activation Test Store',
        businessCategory: 'fashion',
        contactEmail: 'activation@test.com'
      });
      testMerchants.push(testMerchant.id);
    });

    test('should activate merchant', async () => {
      // First deactivate
      await repository.deactivate(testMerchant.id);
      
      const success = await repository.activate(testMerchant.id);
      
      expect(success).toBe(true);
      
      const merchant = await repository.findById(testMerchant.id);
      expect(merchant!.isActive).toBe(true);
    });

    test('should deactivate merchant', async () => {
      const success = await repository.deactivate(testMerchant.id);
      
      expect(success).toBe(true);
      
      const merchant = await repository.findById(testMerchant.id);
      expect(merchant!.isActive).toBe(false);
    });

    test('should return false for non-existent merchant activation', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      
      const success = await repository.activate(nonExistentId);
      
      expect(success).toBe(false);
    });
  });

  describe('Performance and Edge Case Tests', () => {
    test('should handle concurrent message usage updates', async () => {
      const merchant = await repository.create({
        businessName: 'Concurrency Test Store',
        businessCategory: 'test',
        contactEmail: 'concurrency@test.com',
        monthlyMessageLimit: 1000
      });
      testMerchants.push(merchant.id);

      // Make concurrent increment requests
      const increments = Array.from({ length: 10 }, () => 
        repository.incrementMessageUsage(merchant.id, 50)
      );

      const results = await Promise.all(increments);
      const successfulIncrements = results.filter(success => success === true).length;

      // Should handle concurrency gracefully
      expect(successfulIncrements).toBeGreaterThan(0);
      expect(successfulIncrements).toBeLessThanOrEqual(10);

      // Check final usage doesn't exceed limit
      const finalMerchant = await repository.findById(merchant.id);
      expect(finalMerchant!.monthlyMessagesUsed).toBeLessThanOrEqual(1000);
    });

    test('should handle large datasets efficiently', async () => {
      const startTime = Date.now();
      
      // Query should complete quickly even with many records
      const merchants = await repository.findMany({ limit: 100 });
      
      const queryTime = Date.now() - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Should complete within 1 second
      expect(Array.isArray(merchants)).toBe(true);
    });

    test('should validate default message limits for all tiers', async () => {
      const tiers = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'] as const;
      const expectedLimits = {
        FREE: 100,
        BASIC: 1000,
        PREMIUM: 5000,
        ENTERPRISE: 50000
      };

      for (const tier of tiers) {
        const merchant = await repository.create({
          businessName: `${tier} Tier Test`,
          businessCategory: 'test',
          contactEmail: `${tier.toLowerCase()}@test.com`,
          subscriptionTier: tier
        });
        testMerchants.push(merchant.id);

        expect(merchant.monthlyMessageLimit).toBe(expectedLimits[tier]);
      }
    });
  });
});