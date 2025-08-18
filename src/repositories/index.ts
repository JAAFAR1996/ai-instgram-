/**
 * ===============================================
 * Repository Service Manager
 * Central access point for all repositories
 * ===============================================
 */

import { getConversationRepository, type ConversationRepository } from './conversation-repository';
import { getMessageRepository, type MessageRepository } from './message-repository';
import { getMerchantRepository, type MerchantRepository } from './merchant-repository';

export interface RepositoryManager {
  conversation: ConversationRepository;
  message: MessageRepository;
  merchant: MerchantRepository;
}

export class RepositoryService {
  private static instance: RepositoryService | null = null;
  
  public readonly conversation: ConversationRepository;
  public readonly message: MessageRepository;
  public readonly merchant: MerchantRepository;

  private constructor() {
    this.conversation = getConversationRepository();
    this.message = getMessageRepository();
    this.merchant = getMerchantRepository();
  }

  /**
   * Get singleton instance of repository service
   */
  public static getInstance(): RepositoryService {
    if (!RepositoryService.instance) {
      RepositoryService.instance = new RepositoryService();
    }
    return RepositoryService.instance;
  }

  /**
   * Get repository manager object
   */
  public getRepositories(): RepositoryManager {
    return {
      conversation: this.conversation,
      message: this.message,
      merchant: this.merchant
    };
  }

  /**
   * Health check for all repositories
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    repositories: Record<string, { status: 'healthy' | 'unhealthy'; error?: string }>;
  }> {
    const results: Record<string, { status: 'healthy' | 'unhealthy'; error?: string }> = {};

    // Test conversation repository
    try {
      await this.conversation.count();
      results.conversation = { status: 'healthy' };
    } catch (error) {
      results.conversation = { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Test message repository
    try {
      await this.message.count();
      results.message = { status: 'healthy' };
    } catch (error) {
      results.message = { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Test merchant repository
    try {
      await this.merchant.count();
      results.merchant = { status: 'healthy' };
    } catch (error) {
      results.merchant = { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    const overallStatus = Object.values(results).every(r => r.status === 'healthy') 
      ? 'healthy' 
      : 'unhealthy';

    return {
      status: overallStatus,
      repositories: results
    };
  }

  /**
   * Get combined statistics from all repositories
   */
  public async getCombinedStats(merchantId?: string): Promise<{
    merchants: any;
    conversations: any;
    messages: any;
    timestamp: Date;
  }> {
    const [merchantStats, conversationStats, messageStats] = await Promise.all([
      this.merchant.getStats(),
      this.conversation.getStats(merchantId),
      this.message.getStats(undefined, undefined, undefined)
    ]);

    return {
      merchants: merchantStats,
      conversations: conversationStats,
      messages: messageStats,
      timestamp: new Date()
    };
  }
}

/**
 * Get repository service instance
 */
export function getRepositoryService(): RepositoryService {
  return RepositoryService.getInstance();
}

/**
 * Get repositories directly
 */
export function getRepositories(): RepositoryManager {
  return getRepositoryService().getRepositories();
}

// Re-export repository types and classes
export type {
  Conversation,
  CreateConversationRequest,
  UpdateConversationRequest,
  ConversationFilters,
  ConversationStats
} from './conversation-repository';

export type {
  Message,
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageFilters,
  MessageStats,
  ConversationHistory
} from './message-repository';

export type {
  Merchant,
  CreateMerchantRequest,
  UpdateMerchantRequest,
  MerchantFilters,
  MerchantStats,
  MerchantCredentials
} from './merchant-repository';

export {
  ConversationRepository,
  getConversationRepository
} from './conversation-repository';

export {
  MessageRepository,
  getMessageRepository
} from './message-repository';

export {
  MerchantRepository,
  getMerchantRepository
} from './merchant-repository';