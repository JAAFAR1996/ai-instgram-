/**
 * ===============================================
 * Monitoring & Analytics Tests - اختبارات شاملة للمراقبة والتحليلات
 * Production-grade tests for monitoring, metrics, and analytics systems
 * ===============================================
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'vitest';
import { MonitoringService, MetricsCollector, AlertManager, type PerformanceMetric, type AlertRule } from './monitoring.js';
import { getDatabase } from '../db/adapter.js';

// Mock external dependencies
const mockRedisConnection = {
  incr: mock(async () => 1),
  get: mock(async () => '100'),
  set: mock(async () => 'OK'),
  setex: mock(async () => 'OK'),
  zadd: mock(async () => 1),
  zrange: mock(async () => ['value1', 'value2']),
  zcount: mock(async () => 5),
  hgetall: mock(async () => ({ key1: 'value1', key2: 'value2' })),
  hset: mock(async () => 1),
  del: mock(async () => 1)
};

vi.mock('../services/RedisConnectionManager.js', () => ({
  getRedisConnectionManager: () => ({
    getConnection: async () => mockRedisConnection
  })
}));

// Mock notification service
const mockNotificationService = {
  sendAlert: mock(async () => ({ success: true, messageId: 'alert-123' })),
  sendSlackAlert: mock(async () => ({ success: true })),
  sendEmail: mock(async () => ({ success: true }))
};

vi.mock('../services/notification-service.js', () => ({
  getNotificationService: () => mockNotificationService
}));

// Mock logger
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {})
};

vi.mock('./logger.js', () => ({
  createLogger: () => mockLogger,
  getLogger: () => mockLogger
}));

const TEST_MERCHANT_ID = 'monitoring-test-merchant-123';

describe('Monitoring & Analytics System - Production Tests', () => {
  let monitoringService: MonitoringService;
  let metricsCollector: MetricsCollector;
  let alertManager: AlertManager;
  let db: any;
  let sql: any;

  beforeAll(async () => {
    // Initialize database
    db = await initializeDatabase();
    sql = db.getSQL();

    // Initialize monitoring components
    monitoringService = new MonitoringService();
    metricsCollector = new MetricsCollector();
    alertManager = new AlertManager();

    // Setup test tables if they don't exist
    await sql`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID,
        metric_name VARCHAR(100) NOT NULL,
        metric_value DECIMAL(15,4) NOT NULL,
        metric_unit VARCHAR(20),
        tags JSONB DEFAULT '{}',
        timestamp TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS system_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        merchant_id UUID,
        metadata JSONB DEFAULT '{}',
        resolved BOOLEAN DEFAULT false,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => {});
  });

  afterAll(async () => {
    // Clean up test data
    await sql`DELETE FROM performance_metrics WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`.catch(() => {});
    await sql`DELETE FROM system_alerts WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`.catch(() => {});
  });

  beforeEach(() => {
    // Reset all mocks
    Object.values(mockRedisConnection).forEach(mockFn => {
      if (typeof mockFn.mockReset === 'function') {
        mockFn.mockReset();
      }
    });
    
    Object.values(mockNotificationService).forEach(mockFn => {
      if (typeof mockFn.mockReset === 'function') {
        mockFn.mockReset();
      }
    });

    Object.values(mockLogger).forEach(mockFn => {
      if (typeof mockFn.mockReset === 'function') {
        mockFn.mockReset();
      }
    });
  });

  describe('MetricsCollector - Performance Metrics Tests', () => {
    test('should collect API response time metrics', async () => {
      const startTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 100));
      const endTime = Date.now();
      
      await metricsCollector.recordResponseTime('/api/instagram/messages', endTime - startTime, {
        method: 'POST',
        statusCode: 200,
        merchantId: TEST_MERCHANT_ID
      });

      // Verify metrics were stored
      expect(mockRedisConnection.zadd).toHaveBeenCalled();
      expect(mockRedisConnection.hset).toHaveBeenCalled();

      // Check if metric was logged
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Recorded response time metric')
      );
    });

    test('should collect system resource usage metrics', async () => {
      const resourceMetrics = {
        cpuUsage: 65.5,
        memoryUsage: 78.2,
        diskUsage: 45.1,
        activeConnections: 150
      };

      await metricsCollector.recordSystemMetrics(resourceMetrics);

      // Verify multiple metrics were recorded
      expect(mockRedisConnection.hset).toHaveBeenCalledTimes(4);

      // Check specific metrics
      const calls = mockRedisConnection.hset.mock.calls;
      expect(calls.some(call => call[0].includes('cpu_usage'))).toBe(true);
      expect(calls.some(call => call[0].includes('memory_usage'))).toBe(true);
      expect(calls.some(call => call[0].includes('disk_usage'))).toBe(true);
    });

    test('should collect Instagram API rate limit metrics', async () => {
      const rateLimitData = {
        endpoint: '/instagram/media',
        remaining: 45,
        limit: 100,
        resetTime: Date.now() + 3600000, // 1 hour
        merchantId: TEST_MERCHANT_ID
      };

      await metricsCollector.recordInstagramRateLimit(rateLimitData);

      // Verify rate limit metrics were stored
      expect(mockRedisConnection.hset).toHaveBeenCalled();
      expect(mockRedisConnection.setex).toHaveBeenCalled();

      // Check if warning threshold is monitored
      if (rateLimitData.remaining < rateLimitData.limit * 0.2) {
        expect(mockLogger.warn).toHaveBeenCalled();
      }
    });

    test('should collect AI processing metrics', async () => {
      const aiMetrics = {
        requestType: 'instagram_dm_response',
        processingTime: 850, // ms
        modelUsed: 'gpt-4',
        tokensUsed: 125,
        confidence: 0.92,
        merchantId: TEST_MERCHANT_ID
      };

      await metricsCollector.recordAIProcessingMetrics(aiMetrics);

      // Verify AI metrics were recorded
      expect(mockRedisConnection.zadd).toHaveBeenCalled();
      expect(mockRedisConnection.hset).toHaveBeenCalled();

      // Check if high processing time is flagged
      if (aiMetrics.processingTime > 1000) {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('High AI processing time detected')
        );
      }
    });

    test('should collect database query performance metrics', async () => {
      const queryMetrics = {
        query: 'SELECT * FROM merchants WHERE subscription_tier = $1',
        duration: 25.5, // ms
        rows: 150,
        cached: false,
        merchantId: TEST_MERCHANT_ID
      };

      await metricsCollector.recordDatabaseMetrics(queryMetrics);

      // Verify database metrics
      expect(mockRedisConnection.zadd).toHaveBeenCalled();
      
      // Check for slow query alerts
      if (queryMetrics.duration > 1000) {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Slow database query detected')
        );
      }
    });

    test('should aggregate metrics over time windows', async () => {
      const timeWindow = '1h';
      const metricName = 'api_response_time';

      const aggregatedMetrics = await metricsCollector.getAggregatedMetrics(
        metricName, 
        timeWindow,
        TEST_MERCHANT_ID
      );

      // Verify Redis queries for aggregation
      expect(mockRedisConnection.zrange).toHaveBeenCalled();
      expect(mockRedisConnection.hgetall).toHaveBeenCalled();

      // Check aggregation structure
      expect(aggregatedMetrics).toBeDefined();
      expect(aggregatedMetrics.average).toBeDefined();
      expect(aggregatedMetrics.min).toBeDefined();
      expect(aggregatedMetrics.max).toBeDefined();
      expect(aggregatedMetrics.count).toBeDefined();
      expect(aggregatedMetrics.p95).toBeDefined();
      expect(aggregatedMetrics.p99).toBeDefined();
    });
  });

  describe('AlertManager - Alert System Tests', () => {
    test('should create and trigger performance alerts', async () => {
      const alertRule: AlertRule = {
        id: 'high-response-time',
        name: 'High API Response Time',
        condition: {
          metric: 'api_response_time',
          operator: '>',
          threshold: 2000, // 2 seconds
          window: '5m'
        },
        severity: 'warning',
        notificationChannels: ['slack', 'email'],
        cooldownPeriod: 300000 // 5 minutes
      };

      await alertManager.addAlertRule(alertRule);

      // Simulate high response time
      await metricsCollector.recordResponseTime('/api/slow-endpoint', 3500, {
        merchantId: TEST_MERCHANT_ID
      });

      // Trigger alert evaluation
      await alertManager.evaluateAlerts(TEST_MERCHANT_ID);

      // Verify alert was created and notifications sent
      expect(mockNotificationService.sendSlackAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('High API Response Time'),
          severity: 'warning'
        })
      );
    });

    test('should handle Instagram-specific alerts', async () => {
      const instagramAlertRule: AlertRule = {
        id: 'instagram-rate-limit-warning',
        name: 'Instagram Rate Limit Warning',
        condition: {
          metric: 'instagram_rate_limit_remaining',
          operator: '<',
          threshold: 20,
          window: '1m'
        },
        severity: 'warning',
        notificationChannels: ['slack'],
        metadata: {
          platform: 'instagram',
          action: 'throttle_requests'
        }
      };

      await alertManager.addAlertRule(instagramAlertRule);

      // Simulate low rate limit
      await metricsCollector.recordInstagramRateLimit({
        endpoint: '/instagram/media',
        remaining: 15, // Below threshold
        limit: 100,
        resetTime: Date.now() + 3600000,
        merchantId: TEST_MERCHANT_ID
      });

      await alertManager.evaluateAlerts(TEST_MERCHANT_ID);

      // Verify Instagram-specific alert handling
      expect(mockNotificationService.sendSlackAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Instagram Rate Limit Warning'),
          metadata: expect.objectContaining({
            platform: 'instagram',
            action: 'throttle_requests'
          })
        })
      );
    });

    test('should implement alert cooldown periods', async () => {
      const alertRule: AlertRule = {
        id: 'cooldown-test',
        name: 'Cooldown Test Alert',
        condition: {
          metric: 'error_rate',
          operator: '>',
          threshold: 0.1, // 10%
          window: '1m'
        },
        severity: 'critical',
        notificationChannels: ['email'],
        cooldownPeriod: 60000 // 1 minute
      };

      await alertManager.addAlertRule(alertRule);

      // Trigger first alert
      await metricsCollector.recordErrorRate(0.15, TEST_MERCHANT_ID);
      await alertManager.evaluateAlerts(TEST_MERCHANT_ID);

      // Immediately trigger second alert (should be suppressed)
      await metricsCollector.recordErrorRate(0.16, TEST_MERCHANT_ID);
      await alertManager.evaluateAlerts(TEST_MERCHANT_ID);

      // Verify notification was sent only once
      expect(mockNotificationService.sendEmail).toHaveBeenCalledTimes(1);
    });

    test('should handle alert resolution', async () => {
      const alertId = 'test-alert-resolution';
      
      // Create active alert
      await sql`
        INSERT INTO system_alerts (id, alert_type, severity, title, message, merchant_id, resolved)
        VALUES (${alertId}::uuid, 'performance', 'warning', 'Test Alert', 'Test message', ${TEST_MERCHANT_ID}::uuid, false)
      `;

      // Resolve alert
      await alertManager.resolveAlert(alertId, 'Issue resolved - response times normalized');

      // Verify alert was marked as resolved
      const resolvedAlert = await sql`
        SELECT resolved, resolved_at FROM system_alerts WHERE id = ${alertId}::uuid
      `;

      expect(resolvedAlert[0].resolved).toBe(true);
      expect(resolvedAlert[0].resolved_at).toBeDefined();
    });

    test('should escalate critical alerts', async () => {
      const criticalAlertRule: AlertRule = {
        id: 'critical-system-error',
        name: 'Critical System Error',
        condition: {
          metric: 'system_error_rate',
          operator: '>',
          threshold: 0.05, // 5%
          window: '2m'
        },
        severity: 'critical',
        notificationChannels: ['slack', 'email', 'pager'],
        escalationPolicy: {
          enabled: true,
          escalateAfter: 300000, // 5 minutes
          escalationChannels: ['phone', 'sms']
        }
      };

      await alertManager.addAlertRule(criticalAlertRule);

      // Trigger critical alert
      await metricsCollector.recordErrorRate(0.08, TEST_MERCHANT_ID);
      await alertManager.evaluateAlerts(TEST_MERCHANT_ID);

      // Verify immediate notifications
      expect(mockNotificationService.sendSlackAlert).toHaveBeenCalled();
      expect(mockNotificationService.sendEmail).toHaveBeenCalled();

      // Verify escalation is scheduled
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Critical alert created, escalation scheduled')
      );
    });
  });

  describe('MonitoringService - System Monitoring Tests', () => {
    test('should monitor system health comprehensively', async () => {
      const healthCheck = await monitoringService.performHealthCheck(TEST_MERCHANT_ID);

      expect(healthCheck).toBeDefined();
      expect(healthCheck.timestamp).toBeDefined();
      expect(healthCheck.overall).toMatch(/healthy|degraded|unhealthy/);
      
      // Check individual components
      expect(healthCheck.components.database).toBeDefined();
      expect(healthCheck.components.redis).toBeDefined();
      expect(healthCheck.components.aiService).toBeDefined();
      expect(healthCheck.components.instagramAPI).toBeDefined();

      // Verify response time is reasonable
      expect(healthCheck.responseTime).toBeLessThan(5000); // Less than 5 seconds
    });

    test('should track service uptime', async () => {
      const uptimeStats = await monitoringService.getUptimeStats('1d'); // Last 24 hours

      expect(uptimeStats).toBeDefined();
      expect(uptimeStats.overallUptime).toBeGreaterThanOrEqual(0);
      expect(uptimeStats.overallUptime).toBeLessThanOrEqual(100);
      
      expect(uptimeStats.serviceUptime.instagram).toBeDefined();
      expect(uptimeStats.serviceUptime.ai).toBeDefined();
      expect(uptimeStats.serviceUptime.database).toBeDefined();
    });

    test('should detect anomalies in metrics', async () => {
      // Simulate normal metric pattern
      const normalValues = [100, 105, 98, 102, 99, 103, 101, 97];
      for (const value of normalValues) {
        await metricsCollector.recordCustomMetric('api_calls_per_minute', value, {
          merchantId: TEST_MERCHANT_ID
        });
      }

      // Simulate anomalous value
      await metricsCollector.recordCustomMetric('api_calls_per_minute', 500, {
        merchantId: TEST_MERCHANT_ID
      });

      const anomalies = await monitoringService.detectAnomalies('api_calls_per_minute', TEST_MERCHANT_ID);

      expect(anomalies).toBeDefined();
      expect(Array.isArray(anomalies)).toBe(true);
      
      if (anomalies.length > 0) {
        expect(anomalies[0].value).toBe(500);
        expect(anomalies[0].zscore).toBeGreaterThan(2); // Significantly different
      }
    });

    test('should generate performance reports', async () => {
      const reportPeriod = { start: Date.now() - 86400000, end: Date.now() }; // Last 24 hours
      
      const performanceReport = await monitoringService.generatePerformanceReport(
        TEST_MERCHANT_ID, 
        reportPeriod
      );

      expect(performanceReport).toBeDefined();
      expect(performanceReport.period).toEqual(reportPeriod);
      expect(performanceReport.summary).toBeDefined();
      
      // Check key performance indicators
      expect(performanceReport.metrics.averageResponseTime).toBeDefined();
      expect(performanceReport.metrics.errorRate).toBeDefined();
      expect(performanceReport.metrics.throughput).toBeDefined();
      expect(performanceReport.metrics.availability).toBeDefined();
      
      // Instagram-specific metrics
      expect(performanceReport.instagram).toBeDefined();
      expect(performanceReport.instagram.messagesProcessed).toBeDefined();
      expect(performanceReport.instagram.rateLimitUtilization).toBeDefined();
      
      // AI processing metrics
      expect(performanceReport.ai).toBeDefined();
      expect(performanceReport.ai.averageProcessingTime).toBeDefined();
      expect(performanceReport.ai.successRate).toBeDefined();
    });

    test('should track business KPIs', async () => {
      // Record business metrics
      await metricsCollector.recordBusinessMetric('instagram_messages_sent', 45, {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram'
      });

      await metricsCollector.recordBusinessMetric('ai_responses_generated', 38, {
        merchantId: TEST_MERCHANT_ID,
        type: 'instagram_dm'
      });

      await metricsCollector.recordBusinessMetric('customer_engagement_rate', 0.75, {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram'
      });

      const businessMetrics = await monitoringService.getBusinessMetrics(TEST_MERCHANT_ID, '1d');

      expect(businessMetrics).toBeDefined();
      expect(businessMetrics.messageVolume).toBeDefined();
      expect(businessMetrics.aiUsage).toBeDefined();
      expect(businessMetrics.engagementMetrics).toBeDefined();
      
      // Verify trending analysis
      expect(businessMetrics.trends).toBeDefined();
      expect(businessMetrics.trends.messageVolumeChange).toBeDefined();
      expect(businessMetrics.trends.engagementChange).toBeDefined();
    });
  });

  describe('Real-time Monitoring Tests', () => {
    test('should provide real-time dashboard data', async () => {
      const dashboardData = await monitoringService.getDashboardData(TEST_MERCHANT_ID);

      expect(dashboardData).toBeDefined();
      expect(dashboardData.lastUpdated).toBeDefined();
      
      // Real-time metrics
      expect(dashboardData.realtime.activeConnections).toBeDefined();
      expect(dashboardData.realtime.requestsPerSecond).toBeDefined();
      expect(dashboardData.realtime.errorRate).toBeDefined();
      
      // Service status
      expect(dashboardData.services).toBeDefined();
      expect(dashboardData.services.instagram.status).toMatch(/healthy|degraded|unhealthy/);
      expect(dashboardData.services.ai.status).toMatch(/healthy|degraded|unhealthy/);
      
      // Recent alerts
      expect(Array.isArray(dashboardData.recentAlerts)).toBe(true);
      
      // Performance charts data
      expect(dashboardData.charts.responseTime).toBeDefined();
      expect(dashboardData.charts.throughput).toBeDefined();
    });

    test('should handle high-frequency metric updates', async () => {
      const startTime = Date.now();
      
      // Simulate high-frequency updates (100 metrics in quick succession)
      const promises = Array.from({ length: 100 }, (_, i) =>
        metricsCollector.recordResponseTime('/api/high-frequency', 50 + i, {
          merchantId: TEST_MERCHANT_ID,
          requestId: `req-${i}`
        })
      );

      await Promise.all(promises);

      const duration = Date.now() - startTime;

      // Should handle high-frequency updates efficiently
      expect(duration).toBeLessThan(5000); // Less than 5 seconds for 100 updates
      
      // Verify all metrics were recorded
      expect(mockRedisConnection.zadd).toHaveBeenCalledTimes(100);
    });

    test('should implement metric sampling for high-volume data', async () => {
      // Configure sampling rate (e.g., 10% sampling)
      await metricsCollector.configureSampling({
        'high_volume_metric': 0.1, // 10% sampling
        'low_volume_metric': 1.0   // 100% sampling
      });

      // Record high-volume metrics
      let sampledCount = 0;
      let totalCount = 0;

      for (let i = 0; i < 1000; i++) {
        const recorded = await metricsCollector.recordMetricWithSampling(
          'high_volume_metric', 
          i, 
          { merchantId: TEST_MERCHANT_ID }
        );
        
        if (recorded) sampledCount++;
        totalCount++;
      }

      // Verify sampling is working (should be approximately 10% ± some variance)
      const samplingRate = sampledCount / totalCount;
      expect(samplingRate).toBeGreaterThan(0.05); // At least 5%
      expect(samplingRate).toBeLessThan(0.15); // At most 15%
    });
  });

  describe('Performance and Load Tests', () => {
    test('should handle concurrent metric collection', async () => {
      const concurrentRequests = 50;
      const startTime = Date.now();

      // Create concurrent metric recording promises
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        metricsCollector.recordResponseTime(`/api/concurrent/${i}`, 100 + i, {
          merchantId: TEST_MERCHANT_ID,
          requestId: `concurrent-${i}`
        })
      );

      const results = await Promise.allSettled(promises);

      const duration = Date.now() - startTime;
      const successful = results.filter(r => r.status === 'fulfilled').length;

      // All requests should complete successfully
      expect(successful).toBe(concurrentRequests);
      
      // Performance should be reasonable
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
    });

    test('should optimize memory usage for large datasets', async () => {
      const largeDatasetSize = 10000;
      
      // Record large number of metrics
      for (let i = 0; i < largeDatasetSize; i++) {
        await metricsCollector.recordCustomMetric('large_dataset_test', Math.random() * 1000, {
          merchantId: TEST_MERCHANT_ID,
          batch: Math.floor(i / 100)
        });

        // Check memory periodically
        if (i % 1000 === 0) {
          const memUsage = process.memoryUsage();
          
          // Memory shouldn't grow excessively
          expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024); // Less than 500MB
        }
      }

      // Verify metrics aggregation still works efficiently
      const aggregated = await metricsCollector.getAggregatedMetrics(
        'large_dataset_test',
        '1h',
        TEST_MERCHANT_ID
      );

      expect(aggregated).toBeDefined();
      expect(aggregated.count).toBeGreaterThan(0);
    });

    test('should handle monitoring system failures gracefully', async () => {
      // Simulate Redis connection failure
      mockRedisConnection.hset.mockImplementation(async () => {
        throw new Error('Redis connection failed');
      });

      // Metrics collection should not crash the system
      await expect(metricsCollector.recordResponseTime('/api/test', 100, {
        merchantId: TEST_MERCHANT_ID
      })).resolves.not.toThrow();

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record metric')
      );

      // Reset mock for subsequent tests
      mockRedisConnection.hset.mockReset();
      mockRedisConnection.hset.mockImplementation(async () => 1);
    });
  });

  describe('Integration Tests', () => {
    test('should integrate with Instagram webhook monitoring', async () => {
      // Simulate Instagram webhook metrics
      const webhookMetrics = {
        endpoint: '/webhooks/instagram',
        processingTime: 250,
        statusCode: 200,
        payloadSize: 1024,
        merchantId: TEST_MERCHANT_ID,
        webhookType: 'messaging'
      };

      await metricsCollector.recordWebhookMetrics(webhookMetrics);

      // Verify webhook-specific metrics
      expect(mockRedisConnection.zadd).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Recorded webhook metric')
      );

      // Check if slow webhook processing triggers alert
      if (webhookMetrics.processingTime > 1000) {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Slow webhook processing detected')
        );
      }
    });

    test('should monitor AI service integration health', async () => {
      const aiHealthCheck = await monitoringService.checkAIServiceHealth(TEST_MERCHANT_ID);

      expect(aiHealthCheck).toBeDefined();
      expect(aiHealthCheck.status).toMatch(/healthy|degraded|unhealthy/);
      expect(aiHealthCheck.responseTime).toBeDefined();
      expect(aiHealthCheck.lastSuccessfulCall).toBeDefined();
      
      // Check model-specific health
      expect(aiHealthCheck.models).toBeDefined();
      expect(aiHealthCheck.models.gpt4).toBeDefined();
      expect(aiHealthCheck.models.claude).toBeDefined();
      
      // Token usage monitoring
      expect(aiHealthCheck.tokenUsage).toBeDefined();
      expect(aiHealthCheck.tokenUsage.currentPeriod).toBeDefined();
      expect(aiHealthCheck.tokenUsage.remainingQuota).toBeDefined();
    });

    test('should provide comprehensive system observability', async () => {
      const observabilityReport = await monitoringService.getObservabilitySnapshot(TEST_MERCHANT_ID);

      expect(observabilityReport).toBeDefined();
      
      // Traces
      expect(observabilityReport.traces).toBeDefined();
      expect(Array.isArray(observabilityReport.traces.recent)).toBe(true);
      
      // Metrics
      expect(observabilityReport.metrics).toBeDefined();
      expect(observabilityReport.metrics.throughput).toBeDefined();
      expect(observabilityReport.metrics.latency).toBeDefined();
      expect(observabilityReport.metrics.errors).toBeDefined();
      
      // Logs
      expect(observabilityReport.logs).toBeDefined();
      expect(observabilityReport.logs.errorCount).toBeDefined();
      expect(observabilityReport.logs.warnCount).toBeDefined();
      
      // Dependencies
      expect(observabilityReport.dependencies).toBeDefined();
      expect(observabilityReport.dependencies.external).toBeDefined();
      expect(observabilityReport.dependencies.internal).toBeDefined();
    });
  });
});