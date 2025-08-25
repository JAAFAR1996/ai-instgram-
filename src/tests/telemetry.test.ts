/**
 * ===============================================
 * Telemetry Service Tests
 * اختبارات شاملة لخدمة القياس والمراقبة
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'vitest';

import {
  TelemetryService,
  getTelemetryService,
  type TelemetryEvent,
  type TelemetryMetric
} from './telemetry.js';

// Mock dependencies
jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => jest.fn())
  }))
}));

jest.mock('./logger.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('📊 Telemetry Service Tests', () => {
  let telemetryService: TelemetryService;
  let mockSQL: jest.Mock;
  let mockLogger: any;
  let originalPerformance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database
    mockSQL = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => mockSQL
    });

    // Mock logger
    const { getLogger } = require('./logger.js');
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    getLogger.mockReturnValue(mockLogger);

    // Mock performance.now() for consistent timing tests
    originalPerformance = global.performance;
    global.performance = {
      now: jest.fn(() => 1000)
    } as any;

    telemetryService = new TelemetryService();
  });

  afterEach(() => {
    global.performance = originalPerformance;
  });

  describe('Event Tracking', () => {
    test('✅ should track events successfully', async () => {
      mockSQL.mockResolvedValue([]);

      const event: TelemetryEvent = {
        name: 'user_login',
        merchantId: 'merchant-123',
        userId: 'user-456',
        properties: {
          platform: 'instagram',
          source: 'mobile_app'
        }
      };

      await telemetryService.trackEvent(event);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // event_id
          'user_login',
          'merchant-123',
          'user-456',
          expect.stringContaining('platform'),
          expect.any(String) // timestamp
        ])
      );
    });

    test('✅ should handle events without optional fields', async () => {
      mockSQL.mockResolvedValue([]);

      const minimalEvent: TelemetryEvent = {
        name: 'page_view',
        merchantId: 'merchant-123'
      };

      await telemetryService.trackEvent(minimalEvent);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String),
          'page_view',
          'merchant-123',
          null, // userId
          '{}', // empty properties
          expect.any(String)
        ])
      );
    });

    test('✅ should serialize complex properties', async () => {
      mockSQL.mockResolvedValue([]);

      const eventWithComplexProperties: TelemetryEvent = {
        name: 'order_created',
        merchantId: 'merchant-123',
        properties: {
          order: {
            id: 'order-789',
            items: [
              { id: 'item-1', quantity: 2 },
              { id: 'item-2', quantity: 1 }
            ]
          },
          customer: {
            type: 'returning',
            segment: 'premium'
          }
        }
      };

      await telemetryService.trackEvent(eventWithComplexProperties);

      const propertiesArg = mockSQL.mock.calls[0][0][4];
      const parsedProperties = JSON.parse(propertiesArg);
      
      expect(parsedProperties.order.id).toBe('order-789');
      expect(parsedProperties.order.items).toHaveLength(2);
      expect(parsedProperties.customer.type).toBe('returning');
    });

    test('❌ should handle database errors gracefully', async () => {
      mockSQL.mockRejectedValue(new Error('Database connection failed'));

      const event: TelemetryEvent = {
        name: 'test_event',
        merchantId: 'merchant-123'
      };

      // Should not throw
      await expect(telemetryService.trackEvent(event)).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to track event',
        expect.any(Error),
        expect.objectContaining({
          eventName: 'test_event',
          merchantId: 'merchant-123'
        })
      );
    });

    test('✅ should batch multiple events', async () => {
      mockSQL.mockResolvedValue([]);

      const events: TelemetryEvent[] = [
        { name: 'event_1', merchantId: 'merchant-123' },
        { name: 'event_2', merchantId: 'merchant-123' },
        { name: 'event_3', merchantId: 'merchant-456' }
      ];

      await telemetryService.trackEvents(events);

      expect(mockSQL).toHaveBeenCalledTimes(1);
      
      // Verify batch insert structure
      const batchCall = mockSQL.mock.calls[0][0];
      expect(batchCall.length).toBe(3);
    });
  });

  describe('Metric Recording', () => {
    test('✅ should record metrics successfully', async () => {
      mockSQL.mockResolvedValue([]);

      const metric: TelemetryMetric = {
        name: 'response_time',
        value: 150.5,
        unit: 'ms',
        merchantId: 'merchant-123',
        tags: {
          endpoint: '/api/messages',
          method: 'POST'
        }
      };

      await telemetryService.recordMetric(metric);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // metric_id
          'response_time',
          150.5,
          'ms',
          'merchant-123',
          expect.stringContaining('endpoint'),
          expect.any(String) // timestamp
        ])
      );
    });

    test('✅ should handle metrics without optional fields', async () => {
      mockSQL.mockResolvedValue([]);

      const minimalMetric: TelemetryMetric = {
        name: 'cpu_usage',
        value: 75.2
      };

      await telemetryService.recordMetric(minimalMetric);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String),
          'cpu_usage',
          75.2,
          null, // unit
          null, // merchantId
          '{}', // empty tags
          expect.any(String)
        ])
      );
    });

    test('✅ should handle different numeric types', async () => {
      mockSQL.mockResolvedValue([]);

      const integerMetric: TelemetryMetric = {
        name: 'request_count',
        value: 42
      };

      const floatMetric: TelemetryMetric = {
        name: 'success_rate',
        value: 99.95
      };

      await telemetryService.recordMetric(integerMetric);
      await telemetryService.recordMetric(floatMetric);

      expect(mockSQL).toHaveBeenCalledTimes(2);
      expect(mockSQL).toHaveBeenNthCalledWith(1, expect.arrayContaining([
        expect.any(String),
        'request_count',
        42,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      ]));

      expect(mockSQL).toHaveBeenNthCalledWith(2, expect.arrayContaining([
        expect.any(String),
        'success_rate',
        99.95,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      ]));
    });

    test('❌ should handle metric recording errors', async () => {
      mockSQL.mockRejectedValue(new Error('Metric table full'));

      const metric: TelemetryMetric = {
        name: 'test_metric',
        value: 100
      };

      await telemetryService.recordMetric(metric);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record metric',
        expect.any(Error),
        expect.objectContaining({
          metricName: 'test_metric'
        })
      );
    });
  });

  describe('Performance Timing', () => {
    test('✅ should start and end performance timing', async () => {
      let performanceCounter = 1000;
      (global.performance.now as jest.Mock).mockImplementation(() => performanceCounter++);

      mockSQL.mockResolvedValue([]);

      const timerId = telemetryService.startTiming('api_request', 'merchant-123');
      
      // Simulate some work
      performanceCounter += 150;
      
      await telemetryService.endTiming(timerId, {
        endpoint: '/api/test',
        status: 'success'
      });

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String),
          'api_request',
          150, // duration
          'ms',
          'merchant-123',
          expect.stringContaining('endpoint'),
          expect.any(String)
        ])
      );
    });

    test('✅ should return timer ID for tracking', () => {
      const timerId = telemetryService.startTiming('operation', 'merchant-123');
      
      expect(typeof timerId).toBe('string');
      expect(timerId.length).toBeGreaterThan(0);
    });

    test('❌ should handle invalid timer IDs gracefully', async () => {
      await telemetryService.endTiming('nonexistent-timer');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Timer not found',
        expect.objectContaining({
          timerId: 'nonexistent-timer'
        })
      );
    });

    test('✅ should handle multiple concurrent timers', async () => {
      let performanceCounter = 1000;
      (global.performance.now as jest.Mock).mockImplementation(() => performanceCounter++);

      mockSQL.mockResolvedValue([]);

      // Start multiple timers
      const timer1 = telemetryService.startTiming('operation_1', 'merchant-123');
      performanceCounter += 50;
      
      const timer2 = telemetryService.startTiming('operation_2', 'merchant-123');
      performanceCounter += 100;
      
      // End in different order
      await telemetryService.endTiming(timer2);
      performanceCounter += 25;
      
      await telemetryService.endTiming(timer1);

      expect(mockSQL).toHaveBeenCalledTimes(2);
      
      // Check durations
      const call1 = mockSQL.mock.calls[0][0];
      const call2 = mockSQL.mock.calls[1][0];
      
      expect(call1[2]).toBe(100); // operation_2 duration
      expect(call2[2]).toBe(175); // operation_1 duration
    });
  });

  describe('Automatic Metric Tracking', () => {
    test('✅ should track function execution metrics', async () => {
      mockSQL.mockResolvedValue([]);

      const testFunction = jest.fn().mockResolvedValue('result');
      
      const result = await telemetryService.trackFunction(
        'test_operation',
        testFunction,
        'merchant-123',
        { operation: 'test' }
      );

      expect(result).toBe('result');
      expect(testFunction).toHaveBeenCalled();
      
      // Should record timing metric
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String),
          'test_operation',
          expect.any(Number), // duration
          'ms',
          'merchant-123',
          expect.stringContaining('operation'),
          expect.any(String)
        ])
      );
    });

    test('✅ should track function errors', async () => {
      mockSQL.mockResolvedValue([]);

      const errorFunction = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(
        telemetryService.trackFunction(
          'failing_operation',
          errorFunction,
          'merchant-123'
        )
      ).rejects.toThrow('Test error');

      // Should still record timing but with error tag
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String),
          'failing_operation',
          expect.any(Number),
          'ms',
          'merchant-123',
          expect.stringContaining('error'),
          expect.any(String)
        ])
      );
    });

    test('✅ should handle synchronous functions', async () => {
      mockSQL.mockResolvedValue([]);

      const syncFunction = jest.fn().mockReturnValue('sync_result');
      
      const result = await telemetryService.trackFunction(
        'sync_operation',
        syncFunction,
        'merchant-123'
      );

      expect(result).toBe('sync_result');
      expect(mockSQL).toHaveBeenCalled();
    });
  });

  describe('Aggregated Analytics', () => {
    test('✅ should get merchant analytics', async () => {
      const mockAnalytics = [
        {
          total_events: 150,
          total_metrics: 75,
          avg_response_time: 125.5,
          error_rate: 0.02,
          period_start: '2024-01-01T00:00:00Z',
          period_end: '2024-01-31T23:59:59Z'
        }
      ];

      mockSQL.mockResolvedValue(mockAnalytics);

      const analytics = await telemetryService.getMerchantAnalytics(
        'merchant-123',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(analytics).toEqual({
        totalEvents: 150,
        totalMetrics: 75,
        averageResponseTime: 125.5,
        errorRate: 0.02,
        periodStart: new Date('2024-01-01T00:00:00Z'),
        periodEnd: new Date('2024-01-31T23:59:59Z')
      });

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          'merchant-123',
          expect.any(String), // start date
          expect.any(String)  // end date
        ])
      );
    });

    test('✅ should handle empty analytics results', async () => {
      mockSQL.mockResolvedValue([]);

      const analytics = await telemetryService.getMerchantAnalytics(
        'merchant-123',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(analytics).toEqual({
        totalEvents: 0,
        totalMetrics: 0,
        averageResponseTime: 0,
        errorRate: 0,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31')
      });
    });

    test('❌ should handle analytics query errors', async () => {
      mockSQL.mockRejectedValue(new Error('Analytics query failed'));

      const analytics = await telemetryService.getMerchantAnalytics(
        'merchant-123',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(analytics).toEqual({
        totalEvents: 0,
        totalMetrics: 0,
        averageResponseTime: 0,
        errorRate: 0,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31')
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get merchant analytics',
        expect.any(Error),
        expect.objectContaining({
          merchantId: 'merchant-123'
        })
      );
    });
  });

  describe('Event Filtering and Sampling', () => {
    test('✅ should filter events by type', async () => {
      mockSQL.mockResolvedValue([]);

      // Mock environment to enable filtering
      const originalEnv = process.env.TELEMETRY_FILTER_EVENTS;
      process.env.TELEMETRY_FILTER_EVENTS = 'debug,trace';

      const debugEvent: TelemetryEvent = {
        name: 'debug_event',
        merchantId: 'merchant-123'
      };

      const infoEvent: TelemetryEvent = {
        name: 'info_event',
        merchantId: 'merchant-123'
      };

      await telemetryService.trackEvent(debugEvent);
      await telemetryService.trackEvent(infoEvent);

      // Only info_event should be tracked (debug filtered out)
      expect(mockSQL).toHaveBeenCalledTimes(1);

      process.env.TELEMETRY_FILTER_EVENTS = originalEnv;
    });

    test('✅ should sample events based on configuration', async () => {
      mockSQL.mockResolvedValue([]);

      // Mock Math.random to control sampling
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5); // 50%

      // Set sampling rate to 75% (should include this event)
      const originalSampleRate = process.env.TELEMETRY_SAMPLE_RATE;
      process.env.TELEMETRY_SAMPLE_RATE = '0.75';

      const event: TelemetryEvent = {
        name: 'sampled_event',
        merchantId: 'merchant-123'
      };

      await telemetryService.trackEvent(event);

      expect(mockSQL).toHaveBeenCalled();

      Math.random = originalRandom;
      process.env.TELEMETRY_SAMPLE_RATE = originalSampleRate;
    });
  });

  describe('Data Retention', () => {
    test('✅ should clean old telemetry data', async () => {
      mockSQL.mockResolvedValue([{ deleted_count: 1500 }]);

      const deletedCount = await telemetryService.cleanOldData(30); // 30 days

      expect(deletedCount).toBe(1500);
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([30])
      );
    });

    test('✅ should handle cleanup errors', async () => {
      mockSQL.mockRejectedValue(new Error('Cleanup failed'));

      const deletedCount = await telemetryService.cleanOldData(30);

      expect(deletedCount).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to clean old telemetry data',
        expect.any(Error)
      );
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getTelemetryService();
      const instance2 = getTelemetryService();

      expect(instance1).toBe(instance2);
    });

    test('✅ should create instance if not exists', () => {
      // Reset singleton
      (require('./telemetry.js') as any).telemetryServiceInstance = null;

      const instance = getTelemetryService();
      expect(instance).toBeInstanceOf(TelemetryService);
    });
  });

  describe('Performance', () => {
    test('✅ should handle high-volume event tracking', async () => {
      mockSQL.mockResolvedValue([]);

      const events: TelemetryEvent[] = Array.from({ length: 1000 }, (_, i) => ({
        name: `event_${i}`,
        merchantId: 'merchant-123',
        properties: { index: i }
      }));

      const startTime = Date.now();
      await telemetryService.trackEvents(events);
      const endTime = Date.now();

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000);
      expect(mockSQL).toHaveBeenCalled();
    });

    test('✅ should handle concurrent timing operations', async () => {
      mockSQL.mockResolvedValue([]);

      const promises = Array.from({ length: 100 }, async (_, i) => {
        const timerId = telemetryService.startTiming(`operation_${i}`, 'merchant-123');
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 1));
        return telemetryService.endTiming(timerId);
      });

      await Promise.all(promises);

      expect(mockSQL).toHaveBeenCalledTimes(100);
    });
  });

  describe('Error Handling', () => {
    test('✅ should continue working after database errors', async () => {
      // First call fails
      mockSQL.mockRejectedValueOnce(new Error('Database error'));
      // Second call succeeds
      mockSQL.mockResolvedValueOnce([]);

      const event1: TelemetryEvent = {
        name: 'failing_event',
        merchantId: 'merchant-123'
      };

      const event2: TelemetryEvent = {
        name: 'success_event',
        merchantId: 'merchant-123'
      };

      await telemetryService.trackEvent(event1);
      await telemetryService.trackEvent(event2);

      expect(mockSQL).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    test('✅ should handle circular references in properties', async () => {
      mockSQL.mockResolvedValue([]);

      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      const event: TelemetryEvent = {
        name: 'circular_event',
        merchantId: 'merchant-123',
        properties: { circular: circularObj }
      };

      // Should not throw
      await expect(telemetryService.trackEvent(event)).resolves.toBeUndefined();
    });

    test('✅ should handle very large property objects', async () => {
      mockSQL.mockResolvedValue([]);

      const largeObject = {
        bigArray: Array.from({ length: 10000 }, (_, i) => `item_${i}`),
        bigString: 'x'.repeat(100000)
      };

      const event: TelemetryEvent = {
        name: 'large_event',
        merchantId: 'merchant-123',
        properties: largeObject
      };

      await telemetryService.trackEvent(event);

      expect(mockSQL).toHaveBeenCalled();
    });
  });

  describe('Custom Tags and Properties', () => {
    test('✅ should handle complex tag structures', async () => {
      mockSQL.mockResolvedValue([]);

      const metric: TelemetryMetric = {
        name: 'complex_metric',
        value: 42,
        tags: {
          environment: 'production',
          region: 'us-east-1',
          service: {
            name: 'api-gateway',
            version: '1.2.3'
          },
          metadata: {
            requestId: 'req-123',
            userId: 'user-456'
          }
        }
      };

      await telemetryService.recordMetric(metric);

      const tagsArg = mockSQL.mock.calls[0][0][5];
      const parsedTags = JSON.parse(tagsArg);
      
      expect(parsedTags.environment).toBe('production');
      expect(parsedTags.service.name).toBe('api-gateway');
      expect(parsedTags.metadata.requestId).toBe('req-123');
    });

    test('✅ should handle null and undefined values in properties', async () => {
      mockSQL.mockResolvedValue([]);

      const event: TelemetryEvent = {
        name: 'null_properties',
        merchantId: 'merchant-123',
        properties: {
          nullValue: null,
          undefinedValue: undefined,
          emptyString: '',
          zero: 0,
          false: false
        }
      };

      await telemetryService.trackEvent(event);

      const propertiesArg = mockSQL.mock.calls[0][0][4];
      const parsedProperties = JSON.parse(propertiesArg);
      
      expect(parsedProperties.nullValue).toBeNull();
      expect(parsedProperties.undefinedValue).toBeUndefined();
      expect(parsedProperties.emptyString).toBe('');
      expect(parsedProperties.zero).toBe(0);
      expect(parsedProperties.false).toBe(false);
    });
  });
});