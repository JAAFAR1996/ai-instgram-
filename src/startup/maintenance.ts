/**
 * ===============================================
 * Maintenance Startup Module
 * Handles scheduled maintenance tasks and cleanup jobs
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { getRedisIntegrationStatus } from './redis.js';

const log = getLogger({ component: 'maintenance-startup' });

/**
 * Schedule maintenance tasks for the application
 */
export function scheduleMaintenance(pool: Pool): void {
  log.info('📅 Scheduling maintenance tasks...');

  try {
    // Check if Redis integration is available
    const redisStatus = getRedisIntegrationStatus();

    if (redisStatus?.success) {
      log.info('Redis available, enhanced maintenance enabled');
    } else {
      log.warn('Redis not available, scheduling basic maintenance only');
    }
    
    scheduleBasicMaintenanceTasks(pool);

    log.info('✅ Maintenance tasks scheduled successfully');
  } catch (error: any) {
    log.error('❌ Failed to schedule maintenance tasks:', error);
  }
}

// Queue-based maintenance disabled

/**
 * Schedule basic maintenance tasks without queue manager
 */
function scheduleBasicMaintenanceTasks(pool: Pool): void {
  // Schedule database cleanup every 24 hours
  const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  const cleanupTimer = setInterval(async () => {
    try {
      log.info('🧹 Running basic database maintenance...');
      
      const client = await pool.connect();
      try {
        // Mark old conversations as ended (no messages for 30+ days)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const result = await client.query(`
          UPDATE conversations 
          SET ended_at = NOW(), updated_at = NOW()
          WHERE ended_at IS NULL
            AND last_message_at < $1
        `, [cutoffDate]);
        log.info(`Ended ${result.rowCount} inactive conversations`);
        
        // Clean up old messages (90+ days)
        const oldMessageCutoff = new Date();
        oldMessageCutoff.setDate(oldMessageCutoff.getDate() - 90);
        
        const messageResult = await client.query(`
          DELETE FROM message_logs 
          WHERE created_at < $1
        `, [oldMessageCutoff]);
        
        log.info(`Deleted ${messageResult.rowCount} old messages`);
        
      } finally {
        client.release();
      }
      
      log.info('✅ Basic maintenance completed');
    } catch (error: any) {
      log.error('❌ Basic maintenance failed:', error);
    }
  }, cleanupInterval);

  // Unref the timer so it doesn't prevent process exit
  if (typeof cleanupTimer?.unref === 'function') {
    cleanupTimer.unref();
  }

  log.info('Basic maintenance timer scheduled (24h interval)');

  // Schedule vault cleanup every 10 minutes
  const vaultCleanupMs = 10 * 60 * 1000;
  const vaultTimer = setInterval(async () => {
    try {
      const client = await pool.connect();
      try {
        const r = await client.query('SELECT public.cleanup_customer_vaults() as deleted');
        const deleted = r.rows?.[0]?.deleted ?? 0;
        log.info('🧹 Vaults cleanup executed', { deleted });
      } finally {
        client.release();
      }
    } catch (e) {
      log.warn('Vaults cleanup failed', { error: String(e) });
    }
  }, vaultCleanupMs);
  if (typeof vaultTimer?.unref === 'function') vaultTimer.unref();
  log.info('Customer vaults cleanup timer scheduled (10m interval)');
}

/**
 * Perform immediate maintenance check
 */
export async function performMaintenanceCheck(pool: Pool): Promise<void> {
  log.info('🔍 Performing maintenance check...');
  
  try {
    const client = await pool.connect();
    try {
      // Check for stale conversations that should be ended
      const staleResult = await client.query(`
        SELECT COUNT(*) as count
        FROM conversations 
        WHERE is_active = true 
          AND last_activity_at < NOW() - INTERVAL '7 days'
          AND ended_at IS NULL
      `);
      
      const staleCount = parseInt(staleResult.rows[0]?.count || '0');
      if (staleCount > 0) {
        log.warn(`Found ${staleCount} stale conversations that may need attention`);
      }
      
      // Check database size
      const sizeResult = await client.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);
      
      const dbSize = sizeResult.rows[0]?.size;
      log.info(`Current database size: ${dbSize}`);
      
    } finally {
      client.release();
    }
    
    log.info('✅ Maintenance check completed');
  } catch (error: any) {
    log.error('❌ Maintenance check failed:', error);
  }
}
