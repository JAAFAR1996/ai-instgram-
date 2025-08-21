/**
 * ===============================================
 * Queue Manager - Centralized Queue Management
 * Coordinates all job processors and queue operations
 * ===============================================
 */

import { getMessageQueue, type MessageQueue, type QueueJobType } from './message-queue.js';
import { webhookProcessor } from './processors/webhook-processor.js';
import { aiProcessor } from './processors/ai-processor.js';
import { messageDeliveryProcessor } from './processors/message-delivery-processor.js';
import { notificationProcessor } from './processors/notification-processor.js';
import { getRepositories } from '../repositories/index.js';

export interface QueueManagerStats {
  queue: any;
  processors: {
    registered: number;
    types: QueueJobType[];
  };
  performance: {
    avgProcessingTime: number;
    throughputPerHour: number;
    errorRate: number;
  };
  health: 'healthy' | 'degraded' | 'unhealthy';
}

export class QueueManager {
  private messageQueue: MessageQueue;
  private repositories = getRepositories();
  private isInitialized = false;

  constructor() {
    this.messageQueue = getMessageQueue();
  }

  /**
   * Initialize queue manager and register all processors
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ Queue manager already initialized');
      return;
    }

    console.log('🚀 Initializing Queue Manager...');

    // Register all processors
    this.registerProcessors();

    // Start queue processing
    this.messageQueue.startProcessing(3000); // Process every 3 seconds

    // Schedule maintenance jobs
    await this.scheduleMaintenanceJobs();

    this.isInitialized = true;
    console.log('✅ Queue Manager initialized successfully');
  }

  /**
   * Register all job processors
   */
  private registerProcessors(): void {
    // Register webhook processor
    this.messageQueue.registerProcessor('WEBHOOK_PROCESSING', webhookProcessor);
    
    // Register AI processor
    this.messageQueue.registerProcessor('AI_RESPONSE_GENERATION', aiProcessor);

    // Register message delivery processor
    this.messageQueue.registerProcessor('MESSAGE_DELIVERY', messageDeliveryProcessor);

    // Register conversation cleanup processor
    this.messageQueue.registerProcessor('CONVERSATION_CLEANUP', {
      async process(job) {
        console.log(`🧹 Processing conversation cleanup: ${job.payload.type}`);
        
        const repositories = getRepositories();
        
        switch (job.payload.type) {
          case 'end_inactive_conversations':
            const inactiveDays = job.payload.inactiveDays || 30;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
            
            const conversations = await repositories.conversation.findMany({
              isActive: true,
              dateTo: cutoffDate,
              limit: 100
            });
            
            let endedCount = 0;
            for (const conversation of conversations) {
              await repositories.conversation.endConversation(conversation.id);
              endedCount++;
            }
            
            return { success: true, result: { endedCount } };
            
          case 'delete_old_messages':
            const messageDays = job.payload.days || 90;
            const deletedCount = await repositories.message.deleteOldMessages(messageDays);
            
            return { success: true, result: { deletedCount } };
            
          default:
            return { success: false, error: `Unknown cleanup type: ${job.payload.type}` };
        }
      }
    });

    // Register notification processor
    this.messageQueue.registerProcessor('NOTIFICATION_SEND', notificationProcessor);

    console.log('🔧 All job processors registered');
  }

  /**
   * Schedule recurring maintenance jobs
   */
  private async scheduleMaintenanceJobs(): Promise<void> {
    const now = new Date();
    
    // Schedule daily cleanup at 2 AM
    const cleanupTime = new Date(now);
    cleanupTime.setHours(2, 0, 0, 0);
    if (cleanupTime <= now) {
      cleanupTime.setDate(cleanupTime.getDate() + 1);
    }

    await this.messageQueue.addJob({
      type: 'CONVERSATION_CLEANUP',
      payload: { type: 'end_inactive_conversations', inactiveDays: 30 },
      priority: 'LOW',
      scheduledAt: cleanupTime
    });

    await this.messageQueue.addJob({
      type: 'CONVERSATION_CLEANUP',
      payload: { type: 'delete_old_messages', days: 90 },
      priority: 'LOW',
      scheduledAt: new Date(cleanupTime.getTime() + 30 * 60 * 1000) // 30 minutes later
    });

    // Schedule queue cleanup every 6 hours
    const queueCleanupTime = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    
    await this.messageQueue.addJob({
      type: 'SYSTEM_MAINTENANCE',
      payload: { type: 'cleanup_old_jobs', days: 7 },
      priority: 'LOW',
      scheduledAt: queueCleanupTime
    });

    console.log('📅 Maintenance jobs scheduled');
  }

  /**
   * Add webhook processing job
   */
  async addWebhookJob(
    platform: 'instagram' | 'whatsapp',
    merchantId: string,
    webhookData: any,
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL'
  ): Promise<string> {
    const job = await this.messageQueue.addJob({
      type: 'WEBHOOK_PROCESSING',
      payload: {
        platform,
        merchantId,
        webhookData
      },
      priority
    });

    return job.id;
  }

  /**
   * Add AI processing job
   */
  async addAIJob(
    conversationId: string,
    merchantId: string,
    customerId: string,
    messageContent: string,
    platform: 'instagram' | 'whatsapp',
    interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention',
    options: {
      messageId?: string;
      mediaContext?: any;
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
    } = {}
  ): Promise<string> {
    const job = await this.messageQueue.addJob({
      type: 'AI_RESPONSE_GENERATION',
      payload: {
        conversationId,
        merchantId,
        customerId,
        messageContent,
        platform,
        interactionType,
        messageId: options.messageId,
        mediaContext: options.mediaContext
      },
      priority: options.priority || 'NORMAL'
    });

    return job.id;
  }

  /**
   * Add notification job
   */
  async addNotificationJob(
    type: string,
    recipient: string,
    content: any,
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL'
  ): Promise<string> {
    const job = await this.messageQueue.addJob({
      type: 'NOTIFICATION_SEND',
      payload: {
        type,
        recipient,
        content
      },
      priority
    });

    return job.id;
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueManagerStats> {
    const queueStats = await this.messageQueue.getStats();
    
    // Calculate performance metrics
    const errorRate = queueStats.total > 0 ? (queueStats.failed / queueStats.total) * 100 : 0;
    const throughputPerHour = queueStats.completed; // Simplified - should calculate per hour
    
    // Determine health status
    let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (errorRate > 20) {
      health = 'unhealthy';
    } else if (errorRate > 10 || queueStats.pending > 1000) {
      health = 'degraded';
    }

    return {
      queue: queueStats,
      processors: {
        registered: 6, // Number of registered processors
        types: [
          'WEBHOOK_PROCESSING',
          'AI_RESPONSE_GENERATION',
          'MESSAGE_DELIVERY',
          'CONVERSATION_CLEANUP',
          'NOTIFICATION_SEND',
          'SYSTEM_MAINTENANCE'
        ]
      },
      performance: {
        avgProcessingTime: queueStats.avgProcessingTimeMs,
        throughputPerHour,
        errorRate
      },
      health
    };
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(jobType?: QueueJobType): Promise<number> {
    return await this.messageQueue.retryFailedJobs(jobType);
  }

  /**
   * Clean up old jobs
   */
  async cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
    return await this.messageQueue.cleanupOldJobs(olderThanDays);
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(status: string, limit: number = 100): Promise<any[]> {
    return await this.messageQueue.getJobsByStatus(status as any, limit);
  }

  /**
   * Shutdown queue manager
   */
  shutdown(): void {
    this.messageQueue.stopProcessing();
    this.isInitialized = false;
    console.log('🛑 Queue Manager shutdown complete');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: any;
  }> {
    try {
      const stats = await this.getStats();
      
      return {
        status: stats.health,
        details: {
          queueStats: stats.queue,
          processors: stats.processors,
          performance: stats.performance,
          lastChecked: new Date()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date()
        }
      };
    }
  }
}

// Singleton instance
let queueManagerInstance: QueueManager | null = null;

/**
 * Get queue manager instance
 */
export function getQueueManager(): QueueManager {
  if (!queueManagerInstance) {
    queueManagerInstance = new QueueManager();
  }
  return queueManagerInstance;
}

/**
 * Initialize queue system
 */
export async function initializeQueueSystem(): Promise<QueueManager> {
  const queueManager = getQueueManager();
  await queueManager.initialize();
  return queueManager;
}