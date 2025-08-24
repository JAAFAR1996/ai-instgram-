/**
 * ===============================================
 * Database Seeder
 * Creates test data for development and testing
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getPool, withTx } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'database-seeder' });

export class DatabaseSeeder {
  private db = getDatabase();
  private pool = getPool();

  /**
   * Check if seeding is allowed in current environment
   */
  private checkEnvironment(): void {
    const env = getConfig().environment;
    if (env === 'production') {
      throw new Error('Database seeding is not allowed in production environment');
    }
    
    if (env !== 'development' && env !== 'test') {
      log.warn('⚠️ Seeding in non-development environment', { environment: env });
    }
  }

  /**
   * Seed all test data
   */
  public async seed(): Promise<void> {
    try {
      log.info('🌱 Starting database seeding...');
      
      // Environment check
      this.checkEnvironment();
      
      // Test database connection
      await this.testConnection();

      // Clear existing data في التطوير فقط
      if (getConfig().environment === 'development') {
        await this.clearData();
      }

      // Seed in order of dependencies
      const merchants = await this.seedMerchants();
      await this.seedProducts(merchants);
      const conversations = await this.seedConversations(merchants);
      await this.seedOrders(merchants, conversations);
      await this.seedMessageLogs(conversations);

      log.info('✅ Database seeding completed successfully');
    } catch (error) {
      log.error('❌ Database seeding failed:', error);
      throw new Error(`Database seeding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Test database connection
   */
  private async testConnection(): Promise<void> {
    try {
      const sql = this.db.getSQL();
      await sql`SELECT 1 as test`;
      log.info('✅ Database connection test successful');
    } catch (error) {
      log.error('❌ Database connection test failed:', error);
      throw new Error('Database connection failed - cannot proceed with seeding');
    }
  }

  /**
   * Clear existing test data
   */
  public async clearData(): Promise<void> {
    log.info('🗑️ Clearing existing test data...');
    
    try {
      const sql = this.db.getSQL();
      await sql.transaction(async (trx) => {
        // Clear in reverse dependency order
        await trx`DELETE FROM message_logs`;
        await trx`DELETE FROM orders`;
        await trx`DELETE FROM conversations`;
        await trx`DELETE FROM products`;
        await trx`DELETE FROM merchants`;
      });
      
      log.info('✅ Test data cleared successfully');
    } catch (error) {
      log.error('❌ Failed to clear test data:', error);
      throw new Error(`Failed to clear test data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seed merchants
   */
  private async seedMerchants(): Promise<string[]> {
    log.info('👥 Seeding merchants...');
    
    try {
      const sql = this.db.getSQL();
      
      const merchantsData = [
        {
          business_name: 'محل أحمد للموبايلات',
          business_category: 'electronics',
          business_address: 'بغداد - الكرادة - شارع 62',
          whatsapp_number: '+9647801234567',
          whatsapp_number_id: 'WA001',
          instagram_username: '@ahmed_mobiles',
          instagram_user_id: 'IG001',
          email: 'ahmed@example.com',
          subscription_status: 'ACTIVE' as const,
          subscription_tier: 'PREMIUM' as const,
          subscription_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        },
        {
          business_name: 'بوتيك سارة للأزياء',
          business_category: 'fashion',
          business_address: 'بغداد - المنصور - شارع الأميرات',
          whatsapp_number: '+9647801234568',
          whatsapp_number_id: 'WA002',
          instagram_username: '@sara_boutique',
          instagram_user_id: 'IG002',
          email: 'sara@example.com',
          subscription_status: 'ACTIVE' as const,
          subscription_tier: 'BASIC' as const,
          subscription_expires_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15 days from now
        },
        {
          business_name: 'مكتبة النور للكتب',
          business_category: 'books',
          business_address: 'بغداد - الجادرية - قرب الجامعة',
          whatsapp_number: '+9647801234569',
          whatsapp_number_id: 'WA003',
          instagram_username: '@alnoor_books',
          instagram_user_id: 'IG003',
          email: 'noor@example.com',
          subscription_status: 'TRIAL' as const,
          subscription_tier: 'BASIC' as const,
          subscription_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
        }
      ];

      const merchants = await sql<{ id: string }>`
        INSERT INTO merchants (
          business_name, business_category, business_address,
          whatsapp_number, whatsapp_number_id, instagram_username, 
          instagram_user_id, email, subscription_status, 
          subscription_tier, subscription_expires_at
        ) 
        VALUES ${merchantsData.map((m) => [
          m.business_name, m.business_category, m.business_address,
          m.whatsapp_number, m.whatsapp_number_id, m.instagram_username,
          m.instagram_user_id, m.email, m.subscription_status,
          m.subscription_tier, m.subscription_expires_at
        ])}
        RETURNING id
      `;

      log.info(`✅ Created ${merchants.length} merchants`);
      return merchants.map((m) => m.id);
    } catch (error) {
      log.error('❌ Failed to seed merchants:', error);
      throw new Error(`Failed to seed merchants: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seed products
   */
  private async seedProducts(merchantIds: string[]): Promise<void> {
    log.info('📱 Seeding products...');
    
    try {
      const sql = this.db.getSQL();
      
      // Products for Ahmed's Mobile Shop
      const ahmedProducts = [
        {
          merchant_id: merchantIds[0],
          sku: 'IPHONE15-BLACK',
          name_ar: 'آيفون 15 أسود',
          name_en: 'iPhone 15 Black',
          description_ar: 'أحدث إصدار من آيفون بكاميرا 48 ميجابكسل ومعالج A17 Pro',
          category: 'smartphones',
          price_usd: 800,
          cost_usd: 650,
          stock_quantity: 5,
          min_stock_alert: 2,
          attributes: JSON.stringify({
            brand: 'Apple',
            color: 'أسود',
            storage: '128GB',
            screen_size: '6.1 inch',
            camera: '48MP'
          }),
          images: JSON.stringify([
            { url: '/images/iphone15-black-1.jpg', alt: 'آيفون 15 أسود - الواجهة', order: 1 },
            { url: '/images/iphone15-black-2.jpg', alt: 'آيفون 15 أسود - الخلف', order: 2 }
          ]),
          tags: ['آيفون', 'أبل', 'ذكي', 'أسود']
        },
        {
          merchant_id: merchantIds[0],
          sku: 'SAMSUNG-S24',
          name_ar: 'سامسونج جالاكسي S24',
          name_en: 'Samsung Galaxy S24',
          description_ar: 'هاتف سامسونج بكاميرا متطورة وأداء عالي',
          category: 'smartphones',
          price_usd: 600,
          cost_usd: 480,
          stock_quantity: 8,
          min_stock_alert: 3,
          attributes: JSON.stringify({
            brand: 'Samsung',
            color: 'أزرق',
            storage: '256GB',
            screen_size: '6.2 inch',
            camera: '50MP'
          }),
          images: JSON.stringify([
            { url: '/images/samsung-s24-1.jpg', alt: 'سامسونج S24', order: 1 }
          ]),
          tags: ['سامسونج', 'جالاكسي', 'أندرويد']
        },
        {
          merchant_id: merchantIds[0],
          sku: 'XIAOMI-14',
          name_ar: 'شاومي 14 برو',
          name_en: 'Xiaomi 14 Pro',
          description_ar: 'أفضل قيمة مقابل المال - هاتف شاومي بمواصفات عالية',
          category: 'smartphones',
          price_usd: 400,
          cost_usd: 320,
          stock_quantity: 12,
          min_stock_alert: 5,
          attributes: JSON.stringify({
            brand: 'Xiaomi',
            color: 'أبيض',
            storage: '256GB',
            screen_size: '6.73 inch',
            camera: '50MP'
          }),
          tags: ['شاومي', 'اقتصادي', 'قيمة'],
          is_featured: true
        }
      ];

      // Products for Sara's Boutique
      const saraProducts = [
        {
          merchant_id: merchantIds[1],
          sku: 'DRESS-BLUE-M',
          name_ar: 'فستان أزرق أنيق',
          description_ar: 'فستان صيفي أنيق باللون الأزرق مناسب للمناسبات',
          category: 'dresses',
          price_usd: 45,
          cost_usd: 25,
          stock_quantity: 15,
          min_stock_alert: 3,
          attributes: JSON.stringify({
            color: 'أزرق',
            size: 'M',
            material: 'قطن',
            season: 'صيفي'
          }),
          variants: JSON.stringify([
            { name: 'المقاس', values: ['S', 'M', 'L', 'XL'] },
            { name: 'اللون', values: ['أزرق', 'وردي', 'أبيض'] }
          ]),
          tags: ['فستان', 'صيفي', 'أنيق', 'أزرق'],
          is_on_sale: true,
          sale_price_usd: 35
        },
        {
          merchant_id: merchantIds[1],
          sku: 'HIJAB-SILK',
          name_ar: 'حجاب حريري',
          description_ar: 'حجاب حريري فاخر بألوان متعددة',
          category: 'hijab',
          price_usd: 20,
          cost_usd: 12,
          stock_quantity: 30,
          min_stock_alert: 10,
          attributes: JSON.stringify({
            material: 'حرير',
            size: 'موحد'
          }),
          tags: ['حجاب', 'حريري', 'فاخر']
        }
      ];

      // Products for Noor Books
      const noorProducts = [
        {
          merchant_id: merchantIds[2],
          sku: 'BOOK-QURAN',
          name_ar: 'المصحف الشريف',
          description_ar: 'مصحف بخط عثماني واضح مع تفسير مبسط',
          category: 'religious',
          price_usd: 15,
          cost_usd: 8,
          stock_quantity: 25,
          min_stock_alert: 5,
          attributes: JSON.stringify({
            type: 'ديني',
            pages: 604,
            binding: 'مجلد فاخر'
          }),
          tags: ['قرآن', 'مصحف', 'ديني'],
          is_featured: true
        },
        {
          merchant_id: merchantIds[2],
          sku: 'BOOK-ARABIC',
          name_ar: 'كتاب تعلم العربية',
          description_ar: 'كتاب تعليمي لتعلم اللغة العربية للمبتدئين',
          category: 'education',
          price_usd: 12,
          cost_usd: 7,
          stock_quantity: 20,
          min_stock_alert: 5,
          attributes: JSON.stringify({
            type: 'تعليمي',
            level: 'مبتدئ',
            pages: 200
          }),
          tags: ['تعليم', 'عربية', 'مبتدئ']
        }
      ];

      const allProducts = [...ahmedProducts, ...saraProducts, ...noorProducts];

      await sql`
        INSERT INTO products (
          merchant_id, sku, name_ar, name_en, description_ar, category,
          price_usd, cost_usd, stock_quantity, min_stock_alert,
          attributes, variants, images, tags, is_featured, is_on_sale, sale_price_usd
        )
        VALUES ${allProducts.map(p => [
          p.merchant_id, p.sku, p.name_ar, (p as any).name_en ?? null, p.description_ar, p.category,
          p.price_usd, p.cost_usd ?? null, p.stock_quantity, p.min_stock_alert,
          p.attributes ?? '{}', (p as any).variants ?? '[]', (p as any).images ?? '[]', 
          (p as any).tags ?? [], (p as any).is_featured ?? false, (p as any).is_on_sale ?? false, (p as any).sale_price_usd ?? null
        ])}
      `;

      log.info(`✅ Created ${allProducts.length} products`);
    } catch (error) {
      log.error('❌ Failed to seed products:', error);
      throw new Error(`Failed to seed products: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seed conversations
   */
  private async seedConversations(merchantIds: string[]): Promise<string[]> {
    log.info('💬 Seeding conversations...');
    
    try {
      const sql = this.db.getSQL();
      
      const conversationsData = [
        {
          merchant_id: merchantIds[0], // Ahmed's shop
          customer_phone: '+9647701234567',
          customer_name: 'علي أحمد',
          platform: 'whatsapp' as const,
          conversation_stage: 'INTERESTED' as const,
          session_data: JSON.stringify({
            cart: [
              {
                sku: 'IPHONE15-BLACK',
                product_id: 'temp-id',
                name: 'آيفون 15 أسود',
                price: 800,
                quantity: 1,
                total: 800
              }
            ],
            preferences: { color: 'أسود', brand: 'Apple' },
            context: { last_inquiry: 'آيفون 15' },
            interaction_count: 5
          }),
          message_count: 8,
          ai_response_count: 4,
          last_message_at: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
        },
        {
          merchant_id: merchantIds[1], // Sara's boutique
          customer_phone: '+9647701234568',
          customer_name: 'فاطمة محمد',
          platform: 'instagram' as const,
          customer_instagram: '@fatima_fashion',
          conversation_stage: 'CONFIRMING' as const,
          session_data: JSON.stringify({
            cart: [
              {
                sku: 'DRESS-BLUE-M',
                name: 'فستان أزرق أنيق',
                price: 35,
                quantity: 2,
                total: 70
              }
            ],
            preferences: { size: 'M', color: 'أزرق' },
            interaction_count: 12
          }),
          message_count: 15,
          ai_response_count: 8,
          converted_to_order: true,
          last_message_at: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
        },
        {
          merchant_id: merchantIds[0], // Ahmed's shop
          customer_phone: '+9647701234569',
          platform: 'whatsapp' as const,
          conversation_stage: 'BROWSING' as const,
          session_data: JSON.stringify({
            cart: [],
            preferences: {},
            context: { last_inquiry: 'سامسونج' },
            interaction_count: 3
          }),
          message_count: 4,
          ai_response_count: 2,
          last_message_at: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
        }
      ];

      const conversations = await sql<{ id: string }>`
        INSERT INTO conversations (
          merchant_id, customer_phone, customer_name, customer_instagram,
          platform, conversation_stage, session_data, message_count,
          ai_response_count, converted_to_order, last_message_at
        )
        VALUES ${conversationsData.map(c => [
          c.merchant_id, c.customer_phone, c.customer_name || null, c.customer_instagram || null,
          c.platform, c.conversation_stage, c.session_data, c.message_count,
          c.ai_response_count, c.converted_to_order || false, c.last_message_at
        ])}
        RETURNING id
      `;

      log.info(`✅ Created ${conversations.length} conversations`);
      return conversations.map((c) => c.id);
    } catch (error) {
      log.error('❌ Failed to seed conversations:', error);
      throw new Error(`Failed to seed conversations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seed orders
   */
  private async seedOrders(merchantIds: string[], conversationIds: string[]): Promise<void> {
    log.info('📦 Seeding orders...');
    
    try {
      const sql = this.db.getSQL();
      
      const ordersData = [
        {
          merchant_id: merchantIds[1], // Sara's boutique
          conversation_id: conversationIds[1],
          customer_phone: '+9647701234568',
          customer_name: 'فاطمة محمد',
          customer_address: 'بغداد - الكاظمية - حي الجامعة - شارع 7 - بيت رقم 25',
          items: JSON.stringify([
            {
              sku: 'DRESS-BLUE-M',
              name: 'فستان أزرق أنيق مقاس M',
              price: 35,
              quantity: 2,
              total: 70
            }
          ]),
          subtotal_amount: 70,
          delivery_fee: 0,
          total_amount: 70,
          status: 'CONFIRMED' as const,
          payment_method: 'COD' as const,
          order_source: 'instagram' as const,
          delivery_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
          confirmed_at: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
        },
        {
          merchant_id: merchantIds[0], // Ahmed's mobiles
          customer_phone: '+9647701234570',
          customer_name: 'محمد علي',
          customer_address: 'بغداد - الرصافة - شارع المتنبي - عمارة 15 - الطابق 3',
          items: JSON.stringify([
            {
              sku: 'SAMSUNG-S24',
              name: 'سامسونج جالاكسي S24',
              price: 600,
              quantity: 1,
              total: 600
            }
          ]),
          subtotal_amount: 600,
          delivery_fee: 5,
          total_amount: 605,
          status: 'SHIPPED' as const,
          payment_method: 'ZAIN_CASH' as const,
          order_source: 'whatsapp' as const,
          delivery_date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // tomorrow
          confirmed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          shipped_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // yesterday
          tracking_number: 'TRK001234'
        },
        {
          merchant_id: merchantIds[2], // Noor books
          customer_phone: '+9647701234571',
          customer_name: 'أحمد حسن',
          customer_address: 'بغداد - الجادرية - قرب جامعة بغداد - مجمع السكن',
          items: JSON.stringify([
            {
              sku: 'BOOK-QURAN',
              name: 'المصحف الشريف',
              price: 15,
              quantity: 1,
              total: 15
            },
            {
              sku: 'BOOK-ARABIC',
              name: 'كتاب تعلم العربية',
              price: 12,
              quantity: 2,
              total: 24
            }
          ]),
          subtotal_amount: 39,
          delivery_fee: 0,
          total_amount: 39,
          status: 'DELIVERED' as const,
          payment_method: 'COD' as const,
          order_source: 'whatsapp' as const,
          confirmed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
          shipped_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
          delivered_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
        }
      ];

      await sql`
        INSERT INTO orders (
          merchant_id, conversation_id, customer_phone, customer_name, customer_address,
          items, subtotal_amount, delivery_fee, total_amount, status, payment_method,
          order_source, delivery_date, confirmed_at, shipped_at, delivered_at, tracking_number
        )
        VALUES ${ordersData.map(o => [
          o.merchant_id, o.conversation_id || null, o.customer_phone, o.customer_name, o.customer_address,
          o.items, o.subtotal_amount, o.delivery_fee, o.total_amount, o.status, o.payment_method,
          o.order_source, o.delivery_date || null, o.confirmed_at || null, o.shipped_at || null, 
          o.delivered_at || null, o.tracking_number || null
        ])}
      `;

      log.info(`✅ Created ${ordersData.length} orders`);
    } catch (error) {
      log.error('❌ Failed to seed orders:', error);
      throw new Error(`Failed to seed orders: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seed message logs
   */
  private async seedMessageLogs(conversationIds: string[]): Promise<void> {
    log.info('📨 Seeding message logs...');
    
    try {
      const sql = this.db.getSQL();
      
      // Sample messages for conversations
      const messagesData = [
        // Conversation 1 - WhatsApp with Ahmed's shop
        {
          conversation_id: conversationIds[0],
          direction: 'INCOMING' as const,
          platform: 'whatsapp' as const,
          content: 'السلام عليكم، عندكم آيفون 15؟',
          ai_processed: true,
          ai_response_time_ms: 1200,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
        },
        {
          conversation_id: conversationIds[0],
          direction: 'OUTGOING' as const,
          platform: 'whatsapp' as const,
          content: 'وعليكم السلام! أهلاً وسهلاً 📱\nأكيد عندنا آيفون 15 جديد بالكرتون\nالسعر: $800\nمتوفر بالألوان: أسود، أزرق، وردي\nأي لون تفضل؟',
          ai_processed: false,
          delivery_status: 'DELIVERED' as const,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000) // 2 hours ago + 30 seconds
        },
        {
          conversation_id: conversationIds[0],
          direction: 'INCOMING' as const,
          platform: 'whatsapp' as const,
          content: 'أسود، وشنو المواصفات؟',
          ai_processed: true,
          ai_response_time_ms: 800,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000 + 60000) // 2 hours ago + 1 minute
        },
        
        // Conversation 2 - Instagram with Sara's boutique
        {
          conversation_id: conversationIds[1],
          direction: 'INCOMING' as const,
          platform: 'instagram' as const,
          content: 'هاي، شفت الفستان الأزرق بالستوري، متوفر؟',
          ai_processed: true,
          ai_response_time_ms: 1500,
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
        },
        {
          conversation_id: conversationIds[1],
          direction: 'OUTGOING' as const,
          platform: 'instagram' as const,
          content: 'أهلاً حبيبتي! 💙\nأكيد متوفر والحمدلله\nالفستان الأزرق الأنيق:\n✨ السعر: $35 (كان $45)\n✨ متوفر مقاسات: S, M, L, XL\n✨ خامة قطنية ناعمة\nأي مقاس تريدين؟',
          ai_processed: false,
          delivery_status: 'READ' as const,
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000 + 45000) // 1 hour ago + 45 seconds
        }
      ];

      await sql`
        INSERT INTO message_logs (
          conversation_id, direction, platform, content, ai_processed,
          ai_response_time_ms, delivery_status, created_at
        )
        VALUES ${messagesData.map((m) => [
          m.conversation_id, m.direction, m.platform, m.content, m.ai_processed,
          m.ai_response_time_ms || null, m.delivery_status || 'DELIVERED', m.created_at
        ])}
      `;

      log.info(`✅ Created ${messagesData.length} message logs`);
    } catch (error) {
      log.error('❌ Failed to seed message logs:', error);
      throw new Error(`Failed to seed message logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export singleton instance
const seeder = new DatabaseSeeder();

// Export functions
export async function seedDatabase(): Promise<void> {
  await seeder.seed();
}

export async function clearDatabase(): Promise<void> {
  await seeder.clearData();
}

export async function cleanupTestData(): Promise<void> {
  await seeder.clearData();
}

// CLI script runner
if (require.main === module) {
  const command = process.argv[2];
  
  (async () => {
    try {
      switch (command) {
        case 'seed':
          await seedDatabase();
          break;
        case 'clear':
          await clearDatabase();
          break;
        default:
          log.info('📖 Available commands:');
          log.info('  seed  - Seed database with test data');
          log.info('  clear - Clear all test data');
      }
    } catch (error) {
      log.error('❌ Command failed:', error);
      process.exit(1);
    }
  })();
}