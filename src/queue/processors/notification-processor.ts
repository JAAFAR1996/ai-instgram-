/**
 * ===============================================
 * Notification Processor
 * Sends notifications using NotificationService
 * ===============================================
 */

import type { QueueJob, JobProcessor } from '../message-queue.js';
import { getNotificationService, type NotificationPayload } from '../../services/notification-service.js';
import { withTenantJob } from '../withTenantJob.js';

export class NotificationProcessor implements JobProcessor {
  constructor(private service = getNotificationService()) {}

  process = withTenantJob(async (job: QueueJob): Promise<{ success: boolean; result?: any; error?: string }> => {
    const payload = ((job as any).data ?? (job as any).payload) as NotificationPayload;
    try {
      const result = await this.service.send(payload);
      if (result.success) {
        return { success: true, result: { sent: true } };
      }
      return { success: false, error: result.error || 'Notification delivery failed' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown notification error'
      };
    }
  });
}

// Export processor instance
export const notificationProcessor = new NotificationProcessor();