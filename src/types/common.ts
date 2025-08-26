// أنواع مشتركة آمنة للإنتاج
// ===============================================

/**
 * نوع آمن للكائنات المجهولة - بديل لـ Record<string, unknown>
 * يستخدم في جميع أنحاء المشروع للتعامل مع البيانات الديناميكية
 */
export type UnknownRec = Record<string, unknown>;

/**
 * نوع الرسائل المستخدم في تاريخ المحادثات
 * متوافق مع OpenAI API وخدمات المحادثة
 */
export interface MessageLike {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * دالة للتحقق من أن القيمة كائن صالح
 * تستخدم للتحقق من صحة البيانات قبل معالجتها
 */
export function isRecord(v: unknown): v is UnknownRec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * دالة لاستخراج رسالة الخطأ من أي نوع خطأ
 * تعالج الأخطاء بأمان وتوفر رسالة افتراضية
 */
export function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

/**
 * دالة للتحقق من أن القيمة مصفوفة من السلاسل النصية
 * تستخدم للتحقق من صحة البيانات المدخلة
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * دالة لتحويل أي قيمة إلى سلسلة نصية بأمان
 * توفر قيمة افتراضية في حالة الفشل
 */
export function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

/**
 * دالة لتحويل أي قيمة إلى رقم صحيح بأمان
 * توفر قيمة افتراضية في حالة الفشل
 */
export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
