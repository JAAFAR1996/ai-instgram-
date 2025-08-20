/**
 * Simple Notification Service
 * Provides minimal notification sending capability (e.g., email or WebSocket)
 */

export interface NotificationPayload {
  type: string;
  recipient: string;
  content: any;
}

export interface NotificationResult {
  success: boolean;
  error?: string;
}

export class NotificationService {
  /**
   * Send a notification to a recipient
   */
  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      // In a real implementation, integrate with email, SMS, or WebSocket services
      console.log(`🔔 Sending notification to ${payload.recipient} [${payload.type}]`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown notification error'
      };
    }
  }
}

let notificationServiceInstance: NotificationService | null = null;

/**
 * Get singleton notification service
 */
export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}