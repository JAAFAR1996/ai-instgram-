/**
 * ===============================================
 * Service Control Types - أنواع التحكم في الخدمات
 * Defines types and schemas for service control operations
 * ===============================================
 */

import { z } from 'zod';

/**
 * قائمة الخدمات المتاحة للتحكم
 * Available services for control operations
 */
export const SERVICE_NAMES = [
  'instagram',
  'ai_processing', 
  'auto_reply',
  'story_response',
  'comment_response',
  'dm_processing'
] as const;

/**
 * نوع الخدمات المتاحة
 * Available service types
 */
export type ServiceName = typeof SERVICE_NAMES[number];

/**
 * Zod schema للتحقق من صحة بيانات تبديل الخدمة
 * Zod schema for validating service toggle data
 */
export const ToggleServiceSchema = z.object({
  merchantId: z.string().uuid('معرف التاجر يجب أن يكون UUID صالح'),
  service: z.enum(SERVICE_NAMES, {
    errorMap: () => ({ message: 'اسم الخدمة غير صحيح' })
  }),
  enabled: z.boolean(),
  reason: z.string().optional(),
  toggledBy: z.string().optional()
});

/**
 * نوع بيانات تبديل الخدمة
 * Service toggle data type
 */
export type ToggleService = z.infer<typeof ToggleServiceSchema>;

/**
 * حالة الخدمة
 * Service status information
 */
export interface ServiceStatus {
  enabled: boolean;
  lastToggled: Date;
  toggledBy: string;
  reason?: string;
}

/**
 * طلب تبديل الخدمة
 * Service toggle request
 */
export interface ServiceToggleRequest {
  merchantId: string;
  service: ServiceName;
  enabled: boolean;
  reason?: string;
  toggledBy?: string;
}

/**
 * صحة الخدمة
 * Service health information
 */
export interface ServiceHealth {
  service: ServiceName;
  status: 'healthy' | 'degraded' | 'disabled' | 'error';
  enabled: boolean;
  lastCheck: Date;
  errorCount: number;
  uptime: number;
}

/**
 * خدمات التاجر
 * Merchant services status
 */
export interface MerchantServices {
  merchantId: string;
  instagram: ServiceStatus;
  aiProcessing: ServiceStatus;
  autoReply: ServiceStatus;
  storyResponse: ServiceStatus;
  commentResponse: ServiceStatus;
  dmProcessing: ServiceStatus;
}

/**
 * Zod schema للتحقق من معرف التاجر
 * Zod schema for merchant ID validation
 */
export const MerchantIdSchema = z.string().uuid('معرف التاجر يجب أن يكون UUID صالح');

/**
 * Zod schema للتحقق من اسم الخدمة
 * Zod schema for service name validation
 */
export const ServiceNameSchema = z.enum(SERVICE_NAMES, {
  errorMap: () => ({ message: 'اسم الخدمة غير صحيح' })
});

/**
 * دالة للتحقق من صحة معرف التاجر
 * Function to validate merchant ID
 */
export function isValidMerchantId(id: string): boolean {
  return MerchantIdSchema.safeParse(id).success;
}

/**
 * دالة للتحقق من صحة اسم الخدمة
 * Function to validate service name
 */
export function isValidServiceName(service: string): service is ServiceName {
  return ServiceNameSchema.safeParse(service).success;
}