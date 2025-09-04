/**
 * ===============================================
 * Unit of Work Pattern - Transaction Management
 * Manages transactions across multiple repositories
 * ===============================================
 */

import { Pool, PoolClient } from 'pg';
import { withTx } from '../db/index.js';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'unit-of-work' });

export interface UnitOfWorkScope {
  client: PoolClient;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Unit of Work for coordinating repository operations within a transaction
 */
export class UnitOfWork {
  constructor(private pool: Pool) {}

  /**
   * Execute multiple repository operations within a single transaction
   */
  async execute<T>(
    operations: (scope: UnitOfWorkScope) => Promise<T>
  ): Promise<T> {
    return await withTx(this.pool, async (client) => {
      let committed = false;
      let rolledBack = false;

      const scope: UnitOfWorkScope = {
        client,
        async commit() {
          if (committed || rolledBack) {
            throw new Error('Transaction already completed');
          }
          // The transaction will be committed by withTx
          committed = true;
          log.debug('Transaction marked for commit');
        },
        async rollback() {
          if (committed || rolledBack) {
            throw new Error('Transaction already completed');
          }
          rolledBack = true;
          throw new Error('Transaction rolled back by user');
        }
      };

      try {
        const result = await operations(scope);
        
        // Auto-commit if not explicitly committed or rolled back
        if (!committed && !rolledBack) {
          log.debug('Auto-committing transaction');
          committed = true;
        }
        
        return result;
      } catch (error: unknown) {
        if (!rolledBack) {
          log.error('Transaction failed, rolling back:', error);
        }
        throw error;
      }
    });
  }

  /**
   * Execute a simple operation with automatic transaction management
   */
  async executeSimple<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return await this.execute(async (scope) => {
      return await operation(scope.client);
    });
  }
}

/**
 * Create a new Unit of Work instance
 */
export function createUnitOfWork(pool: Pool): UnitOfWork {
  return new UnitOfWork(pool);
}

/**
 * Helper function for executing operations with automatic UoW
 */
export async function withUnitOfWork<T>(
  pool: Pool,
  operations: (scope: UnitOfWorkScope) => Promise<T>
): Promise<T> {
  const uow = createUnitOfWork(pool);
  return await uow.execute(operations);
}

/**
 * Repository base class with UoW support
 */
export abstract class BaseRepository {
  constructor(protected pool: Pool) {}

  /**
   * Execute repository operation with Unit of Work
   */
  protected async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const uow = createUnitOfWork(this.pool);
    return await uow.executeSimple(operation);
  }
}