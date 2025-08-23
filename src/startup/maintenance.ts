/**
 * ===============================================
 * Maintenance Startup Module
 * Handles scheduled maintenance tasks and cleanup jobs
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { getRedisIntegrationStatus, getQueueManager } from './redis.js';

const log = getLogger({ component: 'maintenance-startup' });

/**
 * Schedule maintenance tasks for the application
 */
export function scheduleMaintenance(pool: Pool): void {
  log.info('📅 Scheduling maintenance tasks...');

  try {
    // Check if Redis/Queue integration is available
    const redisStatus = getRedisIntegrationStatus();
    const queueManager = getQueueManager();

    if (redisStatus?.success && queueManager) {
      scheduleQueueMaintenanceTasks(queueManager);
    } else {
      log.warn('Queue manager not available, scheduling basic maintenance only');
      scheduleBasicMaintenanceTasks(pool);
    }

    log.info('✅ Maintenance tasks scheduled successfully');
  } catch (error: any) {
    log.error('❌ Failed to schedule maintenance tasks:', error);
  }
}

/**
 * Schedule maintenance tasks using the queue manager
 */
function scheduleQueueMaintenanceTasks(queueManager: any): void {
  const now = new Date();
  
  // Schedule daily cleanup at 2 AM
  const cleanupTime = new Date(now);
  cleanupTime.setHours(2, 0, 0, 0);
  
  // If it's already past 2 AM today, schedule for tomorrow
  if (cleanupTime <= now) {
    cleanupTime.setDate(cleanupTime.getDate() + 1);
  }

  // Schedule conversation cleanup
  queueManager.addJob({
    type: 'CONVERSATION_CLEANUP',
    payload: { type: 'end_inactive_conversations', inactiveDays: 30 },
    priority: 'LOW',
    scheduledAt: cleanupTime
  }).catch((error: any) => {
    log.error('Failed to schedule conversation cleanup:', error);
  });

  // Schedule old message deletion (30 minutes after conversation cleanup)
  queueManager.addJob({
    type: 'CONVERSATION_CLEANUP',
    payload: { type: 'delete_old_messages', days: 90 },
    priority: 'LOW',
    scheduledAt: new Date(cleanupTime.getTime() + 30 * 60 * 1000)
  }).catch((error: any) => {
    log.error('Failed to schedule message cleanup:', error);
  });

  // Schedule queue cleanup every 6 hours
  const queueCleanupTime = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  
  queueManager.addJob({
    type: 'SYSTEM_MAINTENANCE',
    payload: { type: 'cleanup_old_jobs', days: 7 },
    priority: 'LOW',
    scheduledAt: queueCleanupTime
  }).catch((error: any) => {
    log.error('Failed to schedule queue cleanup:', error);
  });

  log.info('Queue-based maintenance tasks scheduled');
}

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
        // Clean up old inactive conversations (30+ days)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        
        const result = await client.query(`
          UPDATE conversations 
          SET is_active = false, ended_at = NOW()
          WHERE is_active = true 
            AND (last_activity_at < $1 OR updated_at < $1)
            AND ended_at IS NULL
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