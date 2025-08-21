/**
 * ===============================================
 * Enhanced Queue Tests
 * اختبارات شاملة لطابور العمليات المحسن
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';

import {
  EnhancedQueue,
  getEnhancedQueue,
  type EnhancedQueueJob,
  type CreateEnhancedJobRequest,
  type JobProcessorEnhanced,
  type DLQEntry
} from './enhanced-queue.js';

// Mock dependencies
jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => ({
      begin: jest.fn()
    }))
  }))
}));

jest.mock('../services/logger.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('./dead-letter.js', () => ({
  pushDLQ: jest.fn()
}));

describe('⚡ Enhanced Queue Tests', () => {
  let enhancedQueue: EnhancedQueue;
  let mockSQL: jest.Mock;
  let mockTransaction: jest.Mock;
  let mockLogger: any;
  let mockPushDLQ: jest.Mock;

  const sampleJob = {
    id: 'job-123',
    type: 'test_job',
    payload: JSON.stringify({ message: 'test' }),
    priority: 'NORMAL',
    status: 'PENDING',
    attempts: 0,
    max_attempts: 3,
    idempotency_key: 'test-key-123',
    scheduled_at: new Date().toISOString(),
    error_history: '[]',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const sampleJobRequest: CreateEnhancedJobRequest = {
    type: 'test_job',
    payload: { message: 'test payload' },
    priority: 'NORMAL',
    maxAttempts: 3
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database
    mockSQL = jest.fn();
    mockTransaction = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => {
        const sqlFn = mockSQL;
        sqlFn.begin = mockTransaction;
        return sqlFn;
      }
    });

    // Mock logger
    const { getLogger } = require('../services/logger.js');
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    getLogger.mockReturnValue(mockLogger);

    // Mock DLQ
    const { pushDLQ } = require('./dead-letter.js');
    mockPushDLQ = pushDLQ as jest.Mock;

    enhancedQueue = new EnhancedQueue();
  });

  afterEach(() => {
    enhancedQueue.stopProcessing();
  });

  describe('Job Creation', () => {
    test('✅ should create new job successfully', async () => {
      // Mock no existing job
      mockSQL.mockResolvedValueOnce([]);
      // Mock job creation
      mockSQL.mockResolvedValueOnce([sampleJob]);

      const result = await enhancedQueue.addJob(sampleJobRequest);

      expect(result).toBeDefined();
      expect(result!.type).toBe('test_job');
      expect(result!.payload).toEqual({ message: 'test payload' });
      expect(result!.priority).toBe('NORMAL');

      // Verify database calls
      expect(mockSQL).toHaveBeenCalledTimes(2);
    });

    test('✅ should return existing job for duplicate idempotency key', async () => {
      // Mock existing job found
      mockSQL.mockResolvedValueOnce([sampleJob]);

      const result = await enhancedQueue.addJob({
        ...sampleJobRequest,
        idempotencyKey: 'existing-key'
      });

      expect(result).toBeDefined();
      expect(result!.id).toBe('job-123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Duplicate job detected',
        { existingJobId: 'job-123' }
      );

      // Should only check for existing, not create new
      expect(mockSQL).toHaveBeenCalledTimes(1);
    });

    test('❌ should handle unique constraint violations', async () => {
      // Mock no existing job on first check
      mockSQL.mockResolvedValueOnce([]);
      // Mock unique constraint violation on insert
      const uniqueViolationError = new Error('Unique constraint violation');
      uniqueViolationError.code = '23505';
      mockSQL.mockRejectedValueOnce(uniqueViolationError);

      const result = await enhancedQueue.addJob(sampleJobRequest);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Idempotency collision detected',
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );
    });

    test('✅ should generate idempotency key when not provided', async () => {
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([sampleJob]);

      await enhancedQueue.addJob(sampleJobRequest);

      // Check that idempotency key was generated
      const insertCall = mockSQL.mock.calls[1][0];
      expect(insertCall).toEqual(
        expect.arrayContaining([
          expect.any(String) // Generated idempotency key
        ])
      );
    });

    test('✅ should handle different priority levels', async () => {
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([{ ...sampleJob, priority: 'CRITICAL' }]);

      const criticalJob = await enhancedQueue.addJob({
        ...sampleJobRequest,
        priority: 'CRITICAL'
      });

      expect(criticalJob!.priority).toBe('CRITICAL');
    });

    test('✅ should handle scheduled jobs', async () => {
      const futureDate = new Date(Date.now() + 60000); // 1 minute from now
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([{
        ...sampleJob,
        scheduled_at: futureDate.toISOString()
      }]);

      const scheduledJob = await enhancedQueue.addJob({
        ...sampleJobRequest,
        scheduledAt: futureDate
      });

      expect(scheduledJob!.scheduledAt.getTime()).toBe(futureDate.getTime());
    });
  });

  describe('Job Processing', () => {
    const mockProcessor: JobProcessorEnhanced = {
      process: jest.fn()
    };

    beforeEach(() => {
      enhancedQueue.registerProcessor('test_job', mockProcessor);
    });

    test('✅ should process job successfully', async () => {
      // Mock job retrieval
      mockSQL.mockResolvedValueOnce([sampleJob]);
      // Mock job status update
      mockSQL.mockResolvedValueOnce([]);
      // Mock job completion
      mockSQL.mockResolvedValueOnce([]);

      // Mock successful processing
      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: true,
        result: { processed: true }
      });

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      expect(mockProcessor.process).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test_job',
          payload: { message: 'test' }
        })
      );

      // Verify job completion update
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining(['COMPLETED'])
      );
    });

    test('✅ should handle job processing failure with retry', async () => {
      const failingJob = {
        ...sampleJob,
        attempts: 1
      };

      mockSQL.mockResolvedValueOnce([failingJob]);
      mockSQL.mockResolvedValueOnce([]); // Status update
      mockSQL.mockResolvedValueOnce([]); // Retry scheduling

      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Processing failed',
        retry: true
      });

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      
      // Should schedule retry
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          'PENDING', // status
          expect.any(Date), // scheduled_at (future date)
          'Processing failed'
        ])
      );
    });

    test('✅ should send job to DLQ after max attempts', async () => {
      const failedJob = {
        ...sampleJob,
        attempts: 3, // At max attempts
        max_attempts: 3
      };

      mockSQL.mockResolvedValueOnce([failedJob]);
      mockSQL.mockResolvedValueOnce([]); // Status update
      
      // Mock transaction for DLQ
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = jest.fn();
        await callback(mockTx);
        return [];
      });

      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Max attempts reached',
        retry: true
      });

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Job sent to DLQ',
        expect.objectContaining({
          jobId: 'job-123',
          error: 'Max attempts reached'
        })
      );
    });

    test('✅ should force send job to DLQ when dlq flag is true', async () => {
      mockSQL.mockResolvedValueOnce([sampleJob]);
      mockSQL.mockResolvedValueOnce([]); // Status update
      
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = jest.fn();
        await callback(mockTx);
        return [];
      });

      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Critical error',
        dlq: true
      });

      await enhancedQueue.processNextJob();

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('❌ should handle missing processor', async () => {
      const jobWithNoProcessor = {
        ...sampleJob,
        type: 'unknown_job_type'
      };

      mockSQL.mockResolvedValueOnce([jobWithNoProcessor]);
      mockSQL.mockResolvedValueOnce([]); // Status update
      
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = jest.fn();
        await callback(mockTx);
        return [];
      });

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      expect(mockTransaction).toHaveBeenCalled(); // Should go to DLQ
    });

    test('✅ should handle processor exceptions', async () => {
      mockSQL.mockResolvedValueOnce([sampleJob]);
      mockSQL.mockResolvedValueOnce([]); // Status update
      mockSQL.mockResolvedValueOnce([]); // Retry scheduling

      (mockProcessor.process as jest.Mock).mockRejectedValue(
        new Error('Processor crashed')
      );

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      // Should schedule retry
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining(['PENDING'])
      );
    });

    test('✅ should return false when no jobs available', async () => {
      mockSQL.mockResolvedValueOnce([]); // No jobs

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(false);
    });

    test('✅ should respect job priority ordering', async () => {
      await enhancedQueue.processNextJob();

      // Verify SQL query includes priority ordering
      const query = mockSQL.mock.calls[0][0].toString();
      expect(query).toContain('CASE priority');
      expect(query).toContain('CRITICAL');
      expect(query).toContain('HIGH');
      expect(query).toContain('NORMAL');
      expect(query).toContain('LOW');
    });
  });

  describe('Circuit Breaker', () => {
    const mockProcessor: JobProcessorEnhanced = {
      process: jest.fn()
    };

    beforeEach(() => {
      enhancedQueue.registerProcessor('failing_job', mockProcessor);
    });

    test('✅ should open circuit breaker after multiple failures', async () => {
      const failingJob = {
        ...sampleJob,
        type: 'failing_job'
      };

      // Simulate 5 failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        mockSQL.mockResolvedValueOnce([failingJob]);
        mockSQL.mockResolvedValueOnce([]); // Status update
        mockSQL.mockResolvedValueOnce([]); // Retry scheduling

        (mockProcessor.process as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Consistent failure',
          retry: true
        });

        await enhancedQueue.processNextJob();
      }

      // Next attempt should be skipped due to circuit breaker
      mockSQL.mockResolvedValueOnce([failingJob]);

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Circuit breaker open, skipping job',
        { type: 'failing_job' }
      );
    });

    test('✅ should reset circuit breaker after successful processing', async () => {
      const job = {
        ...sampleJob,
        type: 'recovering_job'
      };

      enhancedQueue.registerProcessor('recovering_job', mockProcessor);

      // First, cause some failures
      mockSQL.mockResolvedValueOnce([job]);
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([]);

      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Failure',
        retry: true
      });

      await enhancedQueue.processNextJob();

      // Then succeed
      mockSQL.mockResolvedValueOnce([job]);
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([]);

      (mockProcessor.process as jest.Mock).mockResolvedValue({
        success: true,
        result: { recovered: true }
      });

      await enhancedQueue.processNextJob();

      // Circuit breaker should be reset (no warning about skipping)
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker open'),
        expect.any(Object)
      );
    });
  });

  describe('Idempotency', () => {
    test('✅ should generate consistent idempotency keys', async () => {
      mockSQL.mockResolvedValue([]);

      const request1 = {
        type: 'test_job',
        payload: { id: 123, action: 'process' }
      };

      const request2 = {
        type: 'test_job',
        payload: { id: 123, action: 'process' }
      };

      await enhancedQueue.addJob(request1);
      await enhancedQueue.addJob(request2);

      // Both calls should use same idempotency key (within 5-minute window)
      const key1 = mockSQL.mock.calls[1][0][5]; // idempotency_key parameter
      const key2 = mockSQL.mock.calls[3][0][5]; // idempotency_key parameter

      expect(key1).toBe(key2);
    });

    test('✅ should generate different keys for different payloads', async () => {
      mockSQL.mockResolvedValue([]);

      const request1 = {
        type: 'test_job',
        payload: { id: 123, action: 'process' }
      };

      const request2 = {
        type: 'test_job',
        payload: { id: 124, action: 'process' }
      };

      await enhancedQueue.addJob(request1);
      await enhancedQueue.addJob(request2);

      const key1 = mockSQL.mock.calls[1][0][5];
      const key2 = mockSQL.mock.calls[3][0][5];

      expect(key1).not.toBe(key2);
    });

    test('✅ should use provided idempotency key', async () => {
      mockSQL.mockResolvedValue([]);

      const customKey = 'custom-idempotency-key';
      await enhancedQueue.addJob({
        ...sampleJobRequest,
        idempotencyKey: customKey
      });

      const usedKey = mockSQL.mock.calls[1][0][5];
      expect(usedKey).toBe(customKey);
    });
  });

  describe('Dead Letter Queue (DLQ)', () => {
    test('✅ should get DLQ entries', async () => {
      const mockDLQEntries = [
        {
          id: 'dlq-1',
          original_job_id: 'job-123',
          job_type: 'failed_job',
          payload: '{"test": "data"}',
          last_error: 'Processing failed',
          error_history: '["Error 1", "Error 2"]',
          attempts: 3,
          failed_at: new Date().toISOString(),
          requires_manual_review: true,
          reviewed: false,
          created_at: new Date().toISOString()
        }
      ];

      mockSQL.mockResolvedValue(mockDLQEntries);

      const entries = await enhancedQueue.getDLQEntries(10);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: 'dlq-1',
        originalJobId: 'job-123',
        jobType: 'failed_job',
        payload: { test: 'data' },
        lastError: 'Processing failed',
        errorHistory: ['Error 1', 'Error 2'],
        requiresManualReview: true,
        reviewed: false
      });
    });

    test('✅ should handle malformed JSON in DLQ entries', async () => {
      const mockDLQEntries = [
        {
          id: 'dlq-1',
          original_job_id: 'job-123',
          job_type: 'failed_job',
          payload: 'invalid json',
          last_error: 'Processing failed',
          error_history: 'invalid json array',
          attempts: 3,
          failed_at: new Date().toISOString(),
          requires_manual_review: true,
          reviewed: false,
          created_at: new Date().toISOString()
        }
      ];

      mockSQL.mockResolvedValue(mockDLQEntries);

      const entries = await enhancedQueue.getDLQEntries();

      expect(entries[0].payload).toBeNull();
      expect(entries[0].errorHistory).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    test('✅ should review DLQ entry with retry action', async () => {
      const dlqEntry = {
        id: 'dlq-1',
        job_type: 'failed_job',
        payload: '{"retry": true}'
      };

      // Mock DLQ entry retrieval
      mockSQL.mockResolvedValueOnce([dlqEntry]);
      // Mock job creation during retry
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([sampleJob]);
      // Mock review update
      mockSQL.mockResolvedValueOnce([]);

      await enhancedQueue.reviewDLQEntry(
        'dlq-1',
        'retry',
        'admin-user',
        'Retrying after fix'
      );

      // Should create new job
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          'failed_job',
          expect.any(String), // JSON payload
          'NORMAL',
          3
        ])
      );

      // Should mark as reviewed
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          true, // reviewed
          'admin-user',
          'Retrying after fix'
        ])
      );
    });

    test('✅ should review DLQ entry with discard action', async () => {
      mockSQL.mockResolvedValue([]);

      await enhancedQueue.reviewDLQEntry(
        'dlq-1',
        'discard',
        'admin-user',
        'Discarding invalid job'
      );

      // Should only mark as reviewed (no job creation)
      expect(mockSQL).toHaveBeenCalledTimes(1);
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          true,
          'admin-user',
          'Discarding invalid job'
        ])
      );
    });

    test('✅ should determine manual review requirements', async () => {
      const criticalJob = {
        ...sampleJob,
        priority: 'CRITICAL'
      };

      const securityErrorJob = {
        ...sampleJob,
        priority: 'NORMAL'
      };

      mockSQL.mockResolvedValueOnce([criticalJob]);
      mockSQL.mockResolvedValueOnce([]);
      
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = jest.fn();
        await callback(mockTx);
        return [];
      });

      enhancedQueue.registerProcessor('test_job', {
        process: () => Promise.resolve({
          success: false,
          error: 'Security violation detected',
          dlq: true
        })
      });

      await enhancedQueue.processNextJob();

      // Should require manual review for critical jobs
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('Processing Control', () => {
    test('✅ should start and stop processing', () => {
      enhancedQueue.startProcessing(1000);
      expect(mockLogger.info).toHaveBeenCalledWith('Enhanced queue processing started');

      enhancedQueue.stopProcessing();
      expect(mockLogger.info).toHaveBeenCalledWith('Enhanced queue processing stopped');
    });

    test('✅ should prevent multiple processing starts', () => {
      enhancedQueue.startProcessing();
      enhancedQueue.startProcessing(); // Second call

      expect(mockLogger.warn).toHaveBeenCalledWith('Enhanced queue already processing');
    });

    test('✅ should register processors', () => {
      const processor: JobProcessorEnhanced = {
        process: jest.fn()
      };

      enhancedQueue.registerProcessor('new_job_type', processor);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Enhanced processor registered',
        { type: 'new_job_type' }
      );
    });
  });

  describe('Error Handling', () => {
    test('✅ should handle invalid JSON in job payload', async () => {
      const jobWithInvalidPayload = {
        ...sampleJob,
        payload: 'invalid json'
      };

      mockSQL.mockResolvedValueOnce([jobWithInvalidPayload]);
      mockSQL.mockResolvedValueOnce([]);
      
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = jest.fn();
        await callback(mockTx);
        return [];
      });

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
      expect(mockPushDLQ).toHaveBeenCalledWith({
        reason: 'Invalid JSON in queue payload',
        payload: { rowId: 'job-123' }
      });
      expect(mockTransaction).toHaveBeenCalled(); // Should fail job
    });

    test('✅ should handle database errors gracefully', async () => {
      mockSQL.mockRejectedValue(new Error('Database connection failed'));

      await expect(enhancedQueue.addJob(sampleJobRequest)).rejects.toThrow(
        'Database connection failed'
      );
    });

    test('✅ should handle exponential backoff for retries', async () => {
      const jobWithMultipleAttempts = {
        ...sampleJob,
        attempts: 2
      };

      mockSQL.mockResolvedValueOnce([jobWithMultipleAttempts]);
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([]);

      const processor: JobProcessorEnhanced = {
        process: () => Promise.resolve({
          success: false,
          error: 'Temporary failure',
          retry: true
        })
      };

      enhancedQueue.registerProcessor('test_job', processor);

      await enhancedQueue.processNextJob();

      // Check that scheduled_at is in the future (exponential backoff)
      const retryCall = mockSQL.mock.calls[2][0];
      const scheduledAt = retryCall[1]; // scheduled_at parameter
      expect(new Date(scheduledAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getEnhancedQueue();
      const instance2 = getEnhancedQueue();

      expect(instance1).toBe(instance2);
    });

    test('✅ should create instance if not exists', () => {
      // Reset singleton
      (require('./enhanced-queue.js') as any).enhancedQueueInstance = null;

      const instance = getEnhancedQueue();
      expect(instance).toBeInstanceOf(EnhancedQueue);
    });
  });

  describe('Performance', () => {
    test('✅ should handle concurrent job processing', async () => {
      const jobs = Array.from({ length: 10 }, (_, i) => ({
        ...sampleJob,
        id: `job-${i}`
      }));

      // Mock sequential job processing
      jobs.forEach((job, index) => {
        mockSQL.mockResolvedValueOnce([job]);
        mockSQL.mockResolvedValueOnce([]); // Status update
        mockSQL.mockResolvedValueOnce([]); // Completion
      });

      const processor: JobProcessorEnhanced = {
        process: jest.fn().mockResolvedValue({
          success: true,
          result: { processed: true }
        })
      };

      enhancedQueue.registerProcessor('test_job', processor);

      // Process multiple jobs
      const promises = jobs.map(() => enhancedQueue.processNextJob());
      const results = await Promise.all(promises);

      expect(results.every(result => result === true)).toBe(true);
      expect(processor.process).toHaveBeenCalledTimes(10);
    });

    test('✅ should handle high-volume job creation', async () => {
      const requests = Array.from({ length: 100 }, (_, i) => ({
        type: 'bulk_job',
        payload: { index: i }
      }));

      // Mock no existing jobs and successful creation
      requests.forEach(() => {
        mockSQL.mockResolvedValueOnce([]); // No existing
        mockSQL.mockResolvedValueOnce([sampleJob]); // Creation
      });

      const promises = requests.map(request => enhancedQueue.addJob(request));
      const results = await Promise.all(promises);

      expect(results.every(result => result !== null)).toBe(true);
      expect(mockSQL).toHaveBeenCalledTimes(200); // 2 calls per job
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle null/undefined job fields', async () => {
      const jobWithNulls = {
        ...sampleJob,
        started_at: null,
        completed_at: null,
        failed_at: null,
        dlq_at: null,
        last_error: null,
        result: null
      };

      mockSQL.mockResolvedValueOnce([jobWithNulls]);

      const processor: JobProcessorEnhanced = {
        process: jest.fn().mockResolvedValue({
          success: true,
          result: null
        })
      };

      enhancedQueue.registerProcessor('test_job', processor);

      const processed = await enhancedQueue.processNextJob();

      expect(processed).toBe(true);
    });

    test('✅ should handle empty error history arrays', async () => {
      const jobWithEmptyHistory = {
        ...sampleJob,
        error_history: ''
      };

      mockSQL.mockResolvedValueOnce([jobWithEmptyHistory]);
      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([]);

      const processor: JobProcessorEnhanced = {
        process: jest.fn().mockResolvedValue({
          success: true,
          result: {}
        })
      };

      enhancedQueue.registerProcessor('test_job', processor);

      await enhancedQueue.processNextJob();

      expect(processor.process).toHaveBeenCalled();
    });

    test('✅ should handle very large payloads', async () => {
      const largePayload = {
        data: 'x'.repeat(100000), // 100KB string
        array: Array.from({ length: 10000 }, (_, i) => ({ id: i }))
      };

      mockSQL.mockResolvedValueOnce([]);
      mockSQL.mockResolvedValueOnce([sampleJob]);

      const result = await enhancedQueue.addJob({
        type: 'large_job',
        payload: largePayload
      });

      expect(result).toBeDefined();
    });
  });
});