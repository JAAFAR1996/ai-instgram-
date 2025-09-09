#!/usr/bin/env node

/**
 * ===============================================
 * سكريبت إضافة المنتجات المخصصة
 * Custom Products Addition Script
 * ===============================================
 */

import { Client } from 'pg';
import { config } from 'dotenv';

// تحميل متغيرات البيئة
config();

const MERCHANT_ID = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';

// قائمة المنتجات المخصصة (100 منتج)
const CUSTOM_PRODUCTS = [
  // فئة الملابس
  {
    name_ar: 'قميص رسمي كلاسيك',
    name_en: 'Classic Formal Shirt',
    price_usd: 25000,
    category: 'ملابس',
    stock_quantity: 15,
    description_ar: 'قميص رسمي عالي الجودة من القطن المصري',
    image_urls: ['https://example.com/shirt1.jpg'],
    attributes: { size: 'M', color: 'أبيض', material: 'قطن' }
  },
  {
    name_ar: 'تيشيرت كاجوال',
    name_en: 'Casual T-Shirt',
    price_usd: 18000,
    category: 'ملابس',
    stock_quantity: 25,
    description_ar: 'تيشيرت مريح للاستخدام اليومي',
    image_urls: ['https://example.com/tshirt1.jpg'],
    attributes: { size: 'L', color: 'أزرق', material: 'قطن' }
  },
  {
    name_ar: 'بنطلون جينز',
    name_en: 'Jeans Pants',
    price_usd: 35000,
    category: 'ملابس',
    stock_quantity: 20,
    description_ar: 'بنطلون جينز عالي الجودة',
    image_urls: ['https://example.com/jeans1.jpg'],
    attributes: { size: '32', color: 'أزرق داكن', material: 'دنيم' }
  },
  {
    name_ar: 'فستان أنيق',
    name_en: 'Elegant Dress',
    price_usd: 45000,
    category: 'ملابس',
    stock_quantity: 12,
    description_ar: 'فستان أنيق للمناسبات الخاصة',
    image_urls: ['https://example.com/dress1.jpg'],
    attributes: { size: 'M', color: 'أسود', material: 'حرير' }
  },
  {
    name_ar: 'جاكيت شتوي',
    name_en: 'Winter Jacket',
    price_usd: 65000,
    category: 'ملابس',
    stock_quantity: 8,
    description_ar: 'جاكيت شتوي دافئ ومقاوم للماء',
    image_urls: ['https://example.com/jacket1.jpg'],
    attributes: { size: 'L', color: 'أسود', material: 'بوليستر' }
  },

  // فئة الإلكترونيات
  {
    name_ar: 'سماعات لاسلكية',
    name_en: 'Wireless Headphones',
    price_usd: 85000,
    category: 'إلكترونيات',
    stock_quantity: 30,
    description_ar: 'سماعات لاسلكية عالية الجودة مع إلغاء الضوضاء',
    image_urls: ['https://example.com/headphones1.jpg'],
    attributes: { brand: 'Sony', color: 'أسود', battery: '20 ساعة' }
  },
  {
    name_ar: 'شاحن لاسلكي',
    name_en: 'Wireless Charger',
    price_usd: 25000,
    category: 'إلكترونيات',
    stock_quantity: 40,
    description_ar: 'شاحن لاسلكي سريع للجوالات',
    image_urls: ['https://example.com/charger1.jpg'],
    attributes: { power: '15W', compatibility: 'iPhone/Android' }
  },
  {
    name_ar: 'كاميرا رقمية',
    name_en: 'Digital Camera',
    price_usd: 250000,
    category: 'إلكترونيات',
    stock_quantity: 5,
    description_ar: 'كاميرا رقمية احترافية للتصوير',
    image_urls: ['https://example.com/camera1.jpg'],
    attributes: { megapixels: '24MP', zoom: '10x' }
  },
  {
    name_ar: 'تابلت',
    name_en: 'Tablet',
    price_usd: 180000,
    category: 'إلكترونيات',
    stock_quantity: 15,
    description_ar: 'تابلت عالي الأداء للعمل والترفيه',
    image_urls: ['https://example.com/tablet1.jpg'],
    attributes: { screen: '10 بوصة', storage: '64GB' }
  },
  {
    name_ar: 'ساعة ذكية',
    name_en: 'Smart Watch',
    price_usd: 120000,
    category: 'إلكترونيات',
    stock_quantity: 20,
    description_ar: 'ساعة ذكية مع تتبع اللياقة البدنية',
    image_urls: ['https://example.com/watch1.jpg'],
    attributes: { battery: '7 أيام', water_resistant: 'نعم' }
  },

  // فئة الإكسسوارات
  {
    name_ar: 'حقيبة يد جلدية',
    name_en: 'Leather Handbag',
    price_usd: 75000,
    category: 'إكسسوارات',
    stock_quantity: 18,
    description_ar: 'حقيبة يد جلدية أنيقة وعملية',
    image_urls: ['https://example.com/bag1.jpg'],
    attributes: { material: 'جلد طبيعي', color: 'بني', size: 'متوسط' }
  },
  {
    name_ar: 'محفظة جلدية',
    name_en: 'Leather Wallet',
    price_usd: 35000,
    category: 'إكسسوارات',
    stock_quantity: 35,
    description_ar: 'محفظة جلدية عالية الجودة',
    image_urls: ['https://example.com/wallet1.jpg'],
    attributes: { material: 'جلد طبيعي', color: 'أسود', slots: '12' }
  },
  {
    name_ar: 'نظارات شمسية',
    name_en: 'Sunglasses',
    price_usd: 45000,
    category: 'إكسسوارات',
    stock_quantity: 25,
    description_ar: 'نظارات شمسية عصرية مع حماية من الأشعة فوق البنفسجية',
    image_urls: ['https://example.com/sunglasses1.jpg'],
    attributes: { uv_protection: '100%', frame: 'بلاستيك' }
  },
  {
    name_ar: 'سوار ذهبي',
    name_en: 'Gold Bracelet',
    price_usd: 150000,
    category: 'إكسسوارات',
    stock_quantity: 8,
    description_ar: 'سوار ذهبي أنيق للمناسبات الخاصة',
    image_urls: ['https://example.com/bracelet1.jpg'],
    attributes: { material: 'ذهب 18 قيراط', weight: '15 جرام' }
  },
  {
    name_ar: 'قلادة فضية',
    name_en: 'Silver Necklace',
    price_usd: 65000,
    category: 'إكسسوارات',
    stock_quantity: 12,
    description_ar: 'قلادة فضية أنيقة مع حجر كريم',
    image_urls: ['https://example.com/necklace1.jpg'],
    attributes: { material: 'فضة 925', stone: 'زمرد' }
  },

  // فئة الأحذية
  {
    name_ar: 'حذاء رياضي',
    name_en: 'Sports Shoes',
    price_usd: 85000,
    category: 'أحذية',
    stock_quantity: 30,
    description_ar: 'حذاء رياضي مريح للجري والرياضة',
    image_urls: ['https://example.com/shoes1.jpg'],
    attributes: { size: '42', color: 'أبيض', brand: 'Nike' }
  },
  {
    name_ar: 'حذاء رسمي',
    name_en: 'Formal Shoes',
    price_usd: 95000,
    category: 'أحذية',
    stock_quantity: 15,
    description_ar: 'حذاء رسمي أنيق للمناسبات الرسمية',
    image_urls: ['https://example.com/formal_shoes1.jpg'],
    attributes: { size: '41', color: 'أسود', material: 'جلد' }
  },
  {
    name_ar: 'صندل صيفي',
    name_en: 'Summer Sandals',
    price_usd: 35000,
    category: 'أحذية',
    stock_quantity: 40,
    description_ar: 'صندل مريح للصيف',
    image_urls: ['https://example.com/sandals1.jpg'],
    attributes: { size: '40', color: 'بني', material: 'جلد' }
  },
  {
    name_ar: 'جزمة شتوية',
    name_en: 'Winter Boots',
    price_usd: 120000,
    category: 'أحذية',
    stock_quantity: 10,
    description_ar: 'جزمة شتوية دافئة ومقاومة للماء',
    image_urls: ['https://example.com/boots1.jpg'],
    attributes: { size: '43', color: 'أسود', waterproof: 'نعم' }
  },
  {
    name_ar: 'كعب عالي',
    name_en: 'High Heels',
    price_usd: 55000,
    category: 'أحذية',
    stock_quantity: 20,
    description_ar: 'كعب عالي أنيق للمناسبات',
    image_urls: ['https://example.com/heels1.jpg'],
    attributes: { size: '38', color: 'أسود', height: '8 سم' }
  },

  // فئة العطور
  {
    name_ar: 'عطر رجالي',
    name_en: 'Men\'s Perfume',
    price_usd: 125000,
    category: 'عطور',
    stock_quantity: 25,
    description_ar: 'عطر رجالي فاخر برائحة خشبية',
    image_urls: ['https://example.com/perfume1.jpg'],
    attributes: { volume: '100 مل', type: 'Eau de Parfum' }
  },
  {
    name_ar: 'عطر نسائي',
    name_en: 'Women\'s Perfume',
    price_usd: 135000,
    category: 'عطور',
    stock_quantity: 22,
    description_ar: 'عطر نسائي فاخر برائحة زهرية',
    image_urls: ['https://example.com/perfume2.jpg'],
    attributes: { volume: '100 مل', type: 'Eau de Parfum' }
  },
  {
    name_ar: 'عطر عائلي',
    name_en: 'Family Perfume',
    price_usd: 85000,
    category: 'عطور',
    stock_quantity: 30,
    description_ar: 'عطر مناسب للرجال والنساء',
    image_urls: ['https://example.com/perfume3.jpg'],
    attributes: { volume: '100 مل', type: 'Eau de Toilette' }
  },
  {
    name_ar: 'عطر للأطفال',
    name_en: 'Children\'s Perfume',
    price_usd: 45000,
    category: 'عطور',
    stock_quantity: 35,
    description_ar: 'عطر لطيف وآمن للأطفال',
    image_urls: ['https://example.com/perfume4.jpg'],
    attributes: { volume: '50 مل', type: 'Eau de Cologne' }
  },
  {
    name_ar: 'عطر رياضي',
    name_en: 'Sports Perfume',
    price_usd: 65000,
    category: 'عطور',
    stock_quantity: 28,
    description_ar: 'عطر رياضي منعش للرياضة',
    image_urls: ['https://example.com/perfume5.jpg'],
    attributes: { volume: '100 مل', type: 'Eau de Toilette' }
  }
];

// إضافة 75 منتج إضافي ليكتمل العدد 100
const ADDITIONAL_PRODUCTS = [];

// إنشاء منتجات إضافية متنوعة
const categories = ['ملابس', 'إلكترونيات', 'إكسسوارات', 'أحذية', 'عطور', 'منزل', 'كتب', 'ألعاب'];
const colors = ['أحمر', 'أزرق', 'أخضر', 'أصفر', 'أسود', 'أبيض', 'بني', 'وردي'];
const materials = ['قطن', 'بوليستر', 'جلد', 'خشب', 'بلاستيك', 'معدن', 'زجاج'];

for (let i = 1; i <= 75; i++) {
  const category = categories[Math.floor(Math.random() * categories.length)];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const material = materials[Math.floor(Math.random() * materials.length)];
  
  ADDITIONAL_PRODUCTS.push({
    name_ar: `منتج ${i + 25}`,
    name_en: `Product ${i + 25}`,
    price_usd: Math.floor(Math.random() * 200000) + 10000, // بين 10,000 و 210,000
    category: category,
    stock_quantity: Math.floor(Math.random() * 50) + 1, // بين 1 و 50
    description_ar: `وصف المنتج ${i + 25} - ${category} عالي الجودة`,
    image_urls: [`https://example.com/product${i + 25}.jpg`],
    attributes: { 
      color: color, 
      material: material,
      size: Math.floor(Math.random() * 10) + 35 // بين 35 و 44
    }
  });
}

// دمج جميع المنتجات
const ALL_PRODUCTS = [...CUSTOM_PRODUCTS, ...ADDITIONAL_PRODUCTS];

async function addProducts() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات');

    // إضافة المنتجات
    for (const product of ALL_PRODUCTS) {
      const query = `
        INSERT INTO products (
          merchant_id,
          name_ar,
          name_en,
          price_usd,
          category,
          stock_quantity,
          description_ar,
          image_urls,
          attributes,
          status,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
        )
        ON CONFLICT (merchant_id, name_ar) 
        DO UPDATE SET
          price_usd = EXCLUDED.price_usd,
          stock_quantity = EXCLUDED.stock_quantity,
          updated_at = NOW()
      `;

      const values = [
        MERCHANT_ID,
        product.name_ar,
        product.name_en,
        product.price_usd,
        product.category,
        product.stock_quantity,
        product.description_ar,
        JSON.stringify(product.image_urls),
        JSON.stringify(product.attributes),
        'ACTIVE'
      ];

      await client.query(query, values);
      console.log(`✅ تم إضافة المنتج: ${product.name_ar}`);
    }

    console.log(`🎉 تم إضافة ${ALL_PRODUCTS.length} منتج بنجاح!`);

    // إحصائيات
    const statsQuery = `
      SELECT 
        category,
        COUNT(*) as count,
        AVG(price_usd) as avg_price,
        SUM(stock_quantity) as total_stock
      FROM products 
      WHERE merchant_id = $1 
      GROUP BY category 
      ORDER BY count DESC
    `;

    const stats = await client.query(statsQuery, [MERCHANT_ID]);
    console.log('\n📊 إحصائيات المنتجات:');
    console.table(stats.rows);

  } catch (error) {
    console.error('❌ خطأ في إضافة المنتجات:', error);
  } finally {
    await client.end();
  }
}

// تشغيل السكريبت
if (import.meta.url === `file://${process.argv[1]}`) {
  addProducts();
}

export { addProducts, ALL_PRODUCTS };
