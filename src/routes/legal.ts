/**
 * ===============================================
 * Legal Routes Module
 * Handles static legal pages and privacy endpoints
 * ===============================================
 */

import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'legal-routes' });

/**
 * Register legal and privacy routes on the app
 */
export function registerLegalRoutes(app: Hono): void {
  
  // Privacy Policy (Arabic)
  app.get('/legal/privacy', (c) => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سياسة الخصوصية - منصة المبيعات بالذكاء الاصطناعي</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; background: #f9f9f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .date { color: #7f8c8d; font-style: italic; margin-bottom: 20px; }
        .contact { background: #ecf0f1; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>سياسة الخصوصية</h1>
        <p class="date">آخر تحديث: ${new Date().toLocaleDateString('ar-SA')}</p>
        
        <h2>مقدمة</h2>
        <p>نحن في منصة المبيعات بالذكاء الاصطناعي نحترم خصوصيتك ونلتزم بحماية بياناتك الشخصية. توضح هذه السياسة كيفية جمع واستخدام وحماية معلوماتك.</p>
        
        <h2>البيانات التي نجمعها</h2>
        <ul>
            <li>معلومات الحساب (الاسم، البريد الإلكتروني)</li>
            <li>بيانات المحادثات مع العملاء</li>
            <li>معلومات الاستخدام والتحليلات</li>
            <li>بيانات Instagram Business (عند الربط)</li>
        </ul>
        
        <h2>كيفية استخدام البيانات</h2>
        <ul>
            <li>تقديم خدمات الذكاء الاصطناعي</li>
            <li>تحسين تجربة المستخدم</li>
            <li>التحليلات والإحصائيات</li>
            <li>الدعم الفني والصيانة</li>
        </ul>
        
        <h2>حماية البيانات</h2>
        <p>نستخدم تقنيات التشفير المتقدمة (AES-256) وبروتوكولات الأمان الصناعية لحماية بياناتك.</p>
        
        <h2>مشاركة البيانات</h2>
        <p>لا نشارك بياناتك الشخصية مع أطراف ثالثة إلا في الحالات التالية:</p>
        <ul>
            <li>بموافقتك الصريحة</li>
            <li>لتقديم الخدمات المطلوبة (مثل Instagram API)</li>
            <li>عند الطلب القانوني من السلطات المختصة</li>
        </ul>
        
        <h2>حقوقك</h2>
        <ul>
            <li>الوصول إلى بياناتك</li>
            <li>تصحيح البيانات غير الصحيحة</li>
            <li>حذف بياناتك</li>
            <li>إيقاف معالجة البيانات</li>
            <li>نقل البيانات</li>
        </ul>
        
        <div class="contact">
            <h2>تواصل معنا</h2>
            <p>للاستفسارات حول الخصوصية أو ممارسة حقوقك، تواصل معنا على:</p>
            <p>البريد الإلكتروني: privacy@ai-sales-platform.com</p>
        </div>
    </div>
</body>
</html>`;
    
    return c.html(html);
  });

  // Privacy Policy (English)
  app.get('/legal/privacy/en', (c) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - AI Sales Platform</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; background: #f9f9f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .date { color: #7f8c8d; font-style: italic; margin-bottom: 20px; }
        .contact { background: #ecf0f1; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Privacy Policy</h1>
        <p class="date">Last updated: ${new Date().toLocaleDateString('en-US')}</p>
        
        <h2>Introduction</h2>
        <p>We at AI Sales Platform respect your privacy and are committed to protecting your personal data. This policy explains how we collect, use, and protect your information.</p>
        
        <h2>Data We Collect</h2>
        <ul>
            <li>Account information (name, email)</li>
            <li>Customer conversation data</li>
            <li>Usage information and analytics</li>
            <li>Instagram Business data (when connected)</li>
        </ul>
        
        <h2>How We Use Data</h2>
        <ul>
            <li>Provide AI services</li>
            <li>Improve user experience</li>
            <li>Analytics and statistics</li>
            <li>Technical support and maintenance</li>
        </ul>
        
        <h2>Data Protection</h2>
        <p>We use advanced encryption (AES-256) and industry-standard security protocols to protect your data.</p>
        
        <h2>Data Sharing</h2>
        <p>We do not share your personal data with third parties except in the following cases:</p>
        <ul>
            <li>With your explicit consent</li>
            <li>To provide requested services (such as Instagram API)</li>
            <li>When legally required by authorities</li>
        </ul>
        
        <h2>Your Rights</h2>
        <ul>
            <li>Access your data</li>
            <li>Correct inaccurate data</li>
            <li>Delete your data</li>
            <li>Stop data processing</li>
            <li>Data portability</li>
        </ul>
        
        <div class="contact">
            <h2>Contact Us</h2>
            <p>For privacy inquiries or to exercise your rights, contact us at:</p>
            <p>Email: privacy@ai-sales-platform.com</p>
        </div>
    </div>
</body>
</html>`;
    
    return c.html(html);
  });

  // Terms of Service
  app.get('/legal/terms', (c) => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>شروط الخدمة - منصة المبيعات بالذكاء الاصطناعي</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; background: #f9f9f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .date { color: #7f8c8d; font-style: italic; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>شروط الخدمة</h1>
        <p class="date">آخر تحديث: ${new Date().toLocaleDateString('ar-SA')}</p>
        
        <h2>قبول الشروط</h2>
        <p>باستخدام منصة المبيعات بالذكاء الاصطناعي، فإنك توافق على هذه الشروط والأحكام.</p>
        
        <h2>وصف الخدمة</h2>
        <p>نقدم منصة ذكية لإدارة المبيعات والتفاعل مع العملاء عبر Instagram باستخدام الذكاء الاصطناعي.</p>
        
        <h2>استخدام الخدمة</h2>
        <ul>
            <li>يجب استخدام الخدمة للأغراض القانونية فقط</li>
            <li>عدم إساءة استخدام النظام أو محاولة اختراقه</li>
            <li>احترام خصوصية العملاء وبياناتهم</li>
        </ul>
        
        <h2>القيود والمسؤوليات</h2>
        <p>نحن غير مسؤولين عن:</p>
        <ul>
            <li>انقطاع الخدمة لأسباب خارجة عن سيطرتنا</li>
            <li>الأضرار الناتجة عن سوء الاستخدام</li>
            <li>فقدان البيانات بسبب أخطاء المستخدم</li>
        </ul>
        
        <h2>إنهاء الخدمة</h2>
        <p>يحق لنا إنهاء أو تعليق الحساب في حالة انتهاك هذه الشروط.</p>
    </div>
</body>
</html>`;
    
    return c.html(html);
  });

  // Data Deletion (for Instagram compliance)
  app.get('/legal/deletion', (c) => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>حذف البيانات - منصة المبيعات بالذكاء الاصطناعي</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; background: #f9f9f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #e74c3c; padding-bottom: 10px; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .form { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>طلب حذف البيانات</h1>
        
        <div class="warning">
            <strong>تحذير:</strong> حذف البيانات عملية غير قابلة للإلغاء. سيتم حذف جميع بياناتك بشكل نهائي.
        </div>
        
        <h2>ما سيتم حذفه</h2>
        <ul>
            <li>معلومات الحساب الشخصية</li>
            <li>سجلات المحادثات</li>
            <li>بيانات Instagram المربوطة</li>
            <li>الإعدادات والتفضيلات</li>
            <li>سجلات الاستخدام</li>
        </ul>
        
        <h2>المهلة الزمنية</h2>
        <p>سيتم حذف البيانات خلال 30 يوماً من تاريخ الطلب، وفقاً لمتطلبات Instagram وقوانين حماية البيانات.</p>
        
        <div class="form">
            <h2>تقديم طلب الحذف</h2>
            <p>لتقديم طلب حذف البيانات، يرجى التواصل معنا عبر:</p>
            <ul>
                <li>البريد الإلكتروني: deletion@ai-sales-platform.com</li>
                <li>تضمين معرف المستخدم أو البريد الإلكتروني المسجل</li>
                <li>سبب طلب الحذف (اختياري)</li>
            </ul>
            <p><strong>سنقوم بالرد خلال 72 ساعة لتأكيد استلام الطلب.</strong></p>
        </div>
        
        <h2>استثناءات</h2>
        <p>قد نحتفظ ببعض البيانات المجهولة للأغراض التالية:</p>
        <ul>
            <li>الامتثال للقوانين المحلية</li>
            <li>التحليلات الإحصائية العامة</li>
            <li>منع الاحتيال والإساءة</li>
        </ul>
    </div>
</body>
</html>`;
    
    return c.html(html);
  });

  // Alternative deletion endpoint (for direct Instagram compliance)
  app.get('/deletion.html', (c) => {
    return c.redirect('/legal/deletion');
  });

  // Alternative privacy endpoint 
  app.get('/privacy.html', (c) => {
    return c.redirect('/legal/privacy');
  });

  // Legal index page
  app.get('/legal', (c) => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>الشؤون القانونية - منصة المبيعات بالذكاء الاصطناعي</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; background: #f9f9f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; }
        .links { display: grid; gap: 15px; margin-top: 30px; }
        .link-card { background: #ecf0f1; padding: 20px; border-radius: 5px; text-decoration: none; color: #2c3e50; transition: background 0.3s; }
        .link-card:hover { background: #d5dbdb; }
        .link-card h3 { margin: 0 0 10px 0; color: #3498db; }
    </style>
</head>
<body>
    <div class="container">
        <h1>الشؤون القانونية</h1>
        <p style="text-align: center; color: #7f8c8d;">منصة المبيعات بالذكاء الاصطناعي</p>
        
        <div class="links">
            <a href="/legal/privacy" class="link-card">
                <h3>سياسة الخصوصية</h3>
                <p>كيف نجمع ونستخدم ونحمي بياناتك الشخصية</p>
            </a>
            
            <a href="/legal/terms" class="link-card">
                <h3>شروط الخدمة</h3>
                <p>الشروط والأحكام لاستخدام منصتنا</p>
            </a>
            
            <a href="/legal/deletion" class="link-card">
                <h3>حذف البيانات</h3>
                <p>طلب حذف بياناتك الشخصية نهائياً</p>
            </a>
            
            <a href="/legal/privacy/en" class="link-card">
                <h3>Privacy Policy (English)</h3>
                <p>English version of our privacy policy</p>
            </a>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #7f8c8d;">
            <p>للاستفسارات القانونية: legal@ai-sales-platform.com</p>
        </div>
    </div>
</body>
</html>`;
    
    return c.html(html);
  });

  log.info('Legal routes registered successfully');
}