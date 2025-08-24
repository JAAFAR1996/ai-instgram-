/**
 * ===============================================
 * Repository Service Manager
 * Central access point for all repositories
 * ===============================================
 */

import { getConversationRepository, type ConversationRepository } from './conversation-repository.js';
import { getMessageRepository, type MessageRepository } from './message-repository.js';
import { getMerchantRepository, type MerchantRepository } from './merchant-repository.js';
import { getCredentialsRepository, type CredentialsRepository } from './credentials-repository.js';
import { createUnitOfWork, type UnitOfWork } from '../repos/unit-of-work.js';
import { 
  createTemplate, 
  getTemplateById, 
  listTemplates, 
  updateTemplate, 
  deleteTemplate,
  getTemplateStats
} from '../repos/template.repo.js';
import { getDatabase } from '../db/adapter.js';
import { must } from '../utils/safety.js';

export interface RepositoryManager {
  conversation: ConversationRepository;
  message: MessageRepository;
  merchant: MerchantRepository;
  credentials: CredentialsRepository;
  unitOfWork: UnitOfWork;
  template: {
    create: typeof createTemplate;
    getById: typeof getTemplateById;
    list: typeof listTemplates;
    update: typeof updateTemplate;
    delete: typeof deleteTemplate;
    getStats: typeof getTemplateStats;
  };
}

export class RepositoryService {
  private static instance: RepositoryService | null = null;
  
  public readonly conversation: ConversationRepository;
  public readonly message: MessageRepository;
  public readonly merchant: MerchantRepository;
  public readonly credentials: CredentialsRepository;
  public readonly unitOfWork: UnitOfWork;

  private constructor() {
    this.conversation = getConversationRepository();
    this.message = getMessageRepository();
    this.merchant = getMerchantRepository();
    this.credentials = getCredentialsRepository();
    this.unitOfWork = createUnitOfWork(getDatabase().getPool());
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
      merchant: this.merchant,
      credentials: this.credentials,
      unitOfWork: this.unitOfWork,
      template: {
        create: createTemplate,
        getById: getTemplateById,
        list: listTemplates,
        update: updateTemplate,
        delete: deleteTemplate,
        getStats: getTemplateStats
      }
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

    // Test credentials repository
    try {
      // Simple health check for credentials repository
      await this.credentials.getExpiredTokens();
      results.credentials = { status: 'healthy' };
    } catch (error) {
      results.credentials = { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Test unit of work
    try {
      await this.unitOfWork.executeSimple(async (client) => {
        await client.query('SELECT 1');
      });
      results.unitOfWork = { status: 'healthy' };
    } catch (error) {
      results.unitOfWork = { 
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
    credentials: any;
    timestamp: Date;
  }> {
    const [merchantStats, conversationStats, messageStats] = await Promise.all([
      this.merchant.getStats(),
      this.conversation.getStats(merchantId),
      this.message.getStats(undefined, undefined, undefined)
    ]);

    // Get credentials stats
    const expiredTokens = await this.credentials.getExpiredTokens();
    
    // Get actual total credentials count
    const db = getDatabase();
    const sql = db.getSQL();
    const [totalResult] = await sql`SELECT COUNT(*) as count FROM merchant_credentials WHERE whatsapp_token_encrypted IS NOT NULL OR instagram_token_encrypted IS NOT NULL`;
    const totalCredentials = parseInt(must(totalResult?.count as string, 'count missing'), 10) || 0;
    
    const credentialsStats = {
      expiredTokensCount: expiredTokens.length,
      totalCredentials: totalCredentials
    };

    return {
      merchants: merchantStats,
      conversations: conversationStats,
      messages: messageStats,
      credentials: credentialsStats,
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
} from './conversation-repository.js';

export type {
  Message,
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageFilters,
  MessageStats,
  ConversationHistory
} from './message-repository.js';

export type {
  Merchant,
  CreateMerchantRequest,
  UpdateMerchantRequest,
  MerchantFilters,
  MerchantStats,
  MerchantCredentials
} from './merchant-repository.js';

export type {
  StoredCredentials,
  EncryptedTokenData
} from './credentials-repository.js';

export type {
  UnitOfWorkScope
} from '../repos/unit-of-work.js';

export type {
  Template,
  CreateTemplateInput,
  UtilityMessageType
} from '../repos/template.repo.js';

export {
  ConversationRepository,
  getConversationRepository
} from './conversation-repository.js';

export {
  MessageRepository,
  getMessageRepository
} from './message-repository.js';

export {
  MerchantRepository,
  getMerchantRepository
} from './merchant-repository.js';

export {
  CredentialsRepository,
  getCredentialsRepository
} from './credentials-repository.js';

export {
  UnitOfWork,
  createUnitOfWork,
  withUnitOfWork,
  BaseRepository
} from '../repos/unit-of-work.js';

export {
  createTemplate,
  getTemplateById,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  getTemplateStats
} from '../repos/template.repo.js';