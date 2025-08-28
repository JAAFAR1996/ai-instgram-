# ManyChat Migration Guide
## دليل تشغيل migration لتكامل ManyChat

---

## 🎯 **الهدف**
إضافة جداول ManyChat المطلوبة لقاعدة البيانات وحل مشاكل:
- `relation "manychat_logs" does not exist`
- `relation "manual_followup_queue" does not exist`
- Circuit Breaker في وضع "مفتوح"

---

## 🛠️ **خيارات التنفيذ**

### **الخيار 1: الإعداد السريع (موصى به)**
```bash
node quick-manychat-setup.js
```
- ✅ يفحص الحالة الحالية
- ✅ ينفذ الـ migration
- ✅ يتحقق من النتائج

### **الخيار 2: خطوة بخطوة**

#### أ) فحص الحالة الحالية
```bash
node check-manychat-status.js
```

#### ب) تنفيذ Migration
```bash
node execute-manychat-migration.js
```

#### ج) فحص نهائي
```bash
node check-manychat-status.js
```

### **الخيار 3: تنفيذ مباشر (PostgreSQL)**
```sql
-- تشغيل في psql أو pgAdmin
\i src/database/migrations/053_manychat_integration.sql
```

---

## 📋 **الجداول التي سيتم إنشاؤها**

1. **`manychat_logs`** - تسجيل تفاعلات ManyChat
2. **`manychat_subscribers`** - إدارة المشتركين
3. **`manychat_flows`** - إدارة التدفقات
4. **`manychat_webhooks`** - إدارة webhooks
5. **`manual_followup_queue`** - قائمة المتابعة اليدوية
6. **`merchants.manychat_config`** - عمود إعدادات ManyChat

---

## 🔍 **التحقق من النجاح**

بعد التنفيذ، يجب أن ترى:
```
✅ manychat_logs
✅ manychat_subscribers  
✅ manychat_flows
✅ manychat_webhooks
✅ manual_followup_queue
✅ merchants.manychat_config
```

---

## ⚙️ **متطلبات البيئة**

تأكد من وجود:
```bash
DATABASE_URL=postgresql://user:pass@host:port/database
```

أو استخدم الـ default:
```
postgresql://ai_instgram_user:password@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram
```

---

## 🚀 **بعد Migration**

1. **أضف متغيرات البيئة:**
   ```bash
   MANYCHAT_API_KEY=your_api_key_here
   MANYCHAT_DEFAULT_FLOW_ID=your_flow_id
   ```

2. **أعد تشغيل التطبيق:**
   ```bash
   # في Render أو الخادم
   restart application
   ```

3. **اختبر التكامل:**
   - أرسل رسالة Instagram
   - تحقق من الـ logs
   - تأكد من عدم ظهور أخطاء ManyChat

---

## 🔧 **حل المشاكل**

### **خطأ: Permission denied**
```bash
# تأكد من صلاحيات قاعدة البيانات
GRANT CREATE ON DATABASE ai_instgram TO ai_instgram_user;
```

### **خطأ: Connection refused**
- تحقق من DATABASE_URL
- تأكد من الشبكة والاتصال

### **خطأ: Tables already exist**
- هذا طبيعي، الـ migration يستخدم `IF NOT EXISTS`

---

## 📊 **مراقبة النتائج**

بعد التنفيذ، راقب الـ logs:
```bash
# في Render
mcp__render__list_logs --limit=20 --level=info,error
```

يجب أن ترى:
- ✅ عدم وجود `relation does not exist`
- ✅ ManyChat API calls تعمل
- ✅ Circuit Breaker في وضع closed

---

## ⚡ **Quick Commands**

```bash
# إعداد كامل
npm run setup:manychat

# فحص فقط  
npm run check:manychat

# migration فقط
npm run migrate:manychat
```

---

**🎯 الهدف النهائي:** Instagram → ManyChat تكامل يعمل بدون أخطاء!