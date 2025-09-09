import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require'
});

async function debugConversation() {
  try {
    console.log('🔍 فحص المحادثة الحالية...');
    
    // فحص المحادثة المحددة
    const conversationId = 'e7a24c96-5fc8-401c-bfaa-a367b153cd09';
    
    const messages = await pool.query(`
      SELECT direction, content, ai_processed, processing_time_ms, created_at
      FROM message_logs
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `, [conversationId]);
    
    console.log('📝 جميع الرسائل في المحادثة:');
    messages.rows.forEach((msg, index) => {
      console.log(`  ${index + 1}. ${msg.direction}: ${msg.content}`);
      console.log(`     معالج بـ AI: ${msg.ai_processed ? '✅ نعم' : '❌ لا'}`);
      console.log(`     وقت المعالجة: ${msg.processing_time_ms || 'غير محدد'}ms`);
      console.log(`     التاريخ: ${msg.created_at}`);
      console.log('');
    });
    
    // فحص آخر رسالة AI
    const lastAI = await pool.query(`
      SELECT content, ai_processed, created_at
      FROM message_logs
      WHERE conversation_id = $1 
        AND direction = 'OUTGOING'
        AND ai_processed = true
      ORDER BY created_at DESC
      LIMIT 1
    `, [conversationId]);
    
    if (lastAI.rows.length > 0) {
      console.log('🤖 آخر رد AI:');
      console.log('  - المحتوى:', lastAI.rows[0].content);
      console.log('  - التاريخ:', lastAI.rows[0].created_at);
    }
    
    // فحص إعدادات التاجر
    const merchant = await pool.query(`
      SELECT business_name, business_category, ai_config, currency
      FROM merchants
      WHERE id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid
    `);
    
    if (merchant.rows.length > 0) {
      console.log('🏪 إعدادات التاجر:');
      console.log('  - الاسم:', merchant.rows[0].business_name);
      console.log('  - الفئة:', merchant.rows[0].business_category);
      console.log('  - العملة:', merchant.rows[0].currency);
      console.log('  - إعدادات AI:', merchant.rows[0].ai_config);
    }
    
    // فحص المنتجات
    const products = await pool.query(`
      SELECT name_ar, price_amount, sale_price_amount, stock_quantity
      FROM products
      WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid
        AND status = 'ACTIVE'
      LIMIT 5
    `);
    
    console.log('📦 المنتجات المتوفرة:');
    products.rows.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.name_ar}`);
      console.log(`     السعر: ${product.price_amount} د.ع`);
      console.log(`     سعر البيع: ${product.sale_price_amount} د.ع`);
      console.log(`     المخزون: ${product.stock_quantity}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ خطأ:', error.message);
  } finally {
    await pool.end();
  }
}

debugConversation();
