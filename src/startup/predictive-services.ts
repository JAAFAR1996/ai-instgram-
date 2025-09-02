import { getLogger } from '../services/logger.js';
import PredictiveSchedulerService from '../services/predictive-scheduler.js';
import { getConfig } from '../config/index.js';

const log = getLogger({ component: 'predictive-services-startup' });

let schedulerService: PredictiveSchedulerService | null = null;

/**
 * Initialize and start predictive analytics services
 */
export async function initializePredictiveServices(): Promise<void> {
  try {
    const config = getConfig();
    
    // Check if predictive services are enabled (env-driven, default true)
    const enabledPredictive = process.env.ENABLE_PREDICTIVE_ANALYTICS !== 'false';
    
    if (!enabledPredictive) {
      log.info('Predictive analytics services disabled by configuration');
      return;
    }

    log.info('Initializing predictive analytics services...');

    // Create scheduler service
    schedulerService = new PredictiveSchedulerService();

    // Configure intervals based on environment
    const isProduction = config.environment === 'production';
    const intervals = {
      proactiveMessagesIntervalMs: isProduction ? 5 * 60 * 1000 : 2 * 60 * 1000, // 5 min prod, 2 min dev
      predictionsIntervalMs: isProduction ? 30 * 60 * 1000 : 10 * 60 * 1000, // 30 min prod, 10 min dev
      cleanupIntervalMs: isProduction ? 6 * 60 * 60 * 1000 : 30 * 60 * 1000, // 6 hours prod, 30 min dev
    };

    // Start the scheduler
    schedulerService.startScheduler(intervals);

    log.info('Predictive analytics services initialized successfully', {
      environment: config.environment,
      intervals: {
        proactiveMessages: `${intervals.proactiveMessagesIntervalMs / 1000}s`,
        predictions: `${intervals.predictionsIntervalMs / 1000}s`,
        cleanup: `${intervals.cleanupIntervalMs / 1000}s`,
      }
    });

    // Set up graceful shutdown
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

  } catch (error) {
    log.error('Failed to initialize predictive services', { error: String(error) });
    throw error;
  }
}

/**
 * Graceful shutdown of predictive services
 */
async function gracefulShutdown(): Promise<void> {
  try {
    log.info('Shutting down predictive analytics services...');
    
    if (schedulerService) {
      schedulerService.stopScheduler();
      schedulerService = null;
    }

    log.info('Predictive analytics services shut down successfully');
  } catch (error) {
    log.error('Error during predictive services shutdown', { error: String(error) });
  }
}

/**
 * Get scheduler service instance (for health checks, admin operations)
 */
export function getSchedulerService(): PredictiveSchedulerService | null {
  return schedulerService;
}

/**
 * Health check for predictive services
 */
export function checkPredictiveServicesHealth(): {
  status: 'healthy' | 'unhealthy' | 'disabled';
  scheduler?: { running: boolean };
  lastError?: string;
} {
  try {
    if (!schedulerService) {
      return { status: 'disabled' };
    }

    const schedulerStatus = schedulerService.getStatus();
    
    return {
      status: schedulerStatus.isRunning ? 'healthy' : 'unhealthy',
      scheduler: { running: schedulerStatus.isRunning },
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      lastError: String(error),
    };
  }
}

/**
 * Manual trigger for predictive analytics (for admin/debugging)
 */
export async function runManualPredictiveAnalytics(): Promise<{
  success: boolean;
  results?: Record<string, unknown>;
  error?: string;
}> {
  try {
    if (!schedulerService) {
      return {
        success: false,
        error: 'Scheduler service not initialized',
      };
    }

    const results = await schedulerService.runManualCycle();
    
    return {
      success: true,
      results,
    };

  } catch (error) {
    log.error('Manual predictive analytics failed', { error: String(error) });
    return {
      success: false,
      error: String(error),
    };
  }
}
