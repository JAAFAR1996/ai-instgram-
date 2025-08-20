/**
 * ===============================================
 * Notification Processor
 * Sends notifications using NotificationService
 * ===============================================
 */

import type { QueueJob, JobProcessor } from '../message-queue.js';
import { getNotificationService, type NotificationPayload } from '../../services/notification-service.js';

export class NotificationProcessor implements JobProcessor {
  constructor(private service = getNotificationService()) {}

  async process(job: QueueJob): Promise<{ success: boolean; result?: any; error?: string }> {
    const payload = job.payload as NotificationPayload;
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
  }
}

// Export processor instance
export const notificationProcessor = new NotificationProcessor();