/**
 * ===============================================
 * OpenTelemetry Metrics & Observability (2025 Standards)
 * ✅ Production-grade monitoring and metrics collection
 * ===============================================
 */

import { metrics, trace, context } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { TracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/auto-instrumentations-node';
import { getConfig } from '@/config/environment';

export interface MetricsCollector {
  // Meta API metrics
  metaRequestsTotal: any;
  metaLatency: any;
  metaRateLimited: any;
  
  // WhatsApp/Instagram metrics
  messagesTotal: any;
  messagesSent: any;
  messagesDelivered: any;
  messagesFailed: any;
  
  // Queue metrics
  queueJobsTotal: any;
  queueProcessingTime: any;
  queueDepth: any;
  dlqJobs: any;
  
  // Business metrics
  conversionsTotal: any;
  ordersTotal: any;
  revenueTotal: any;
  merchantsActive: any;
  
  // System metrics
  httpRequestsTotal: any;
  httpRequestDuration: any;
  databaseConnections: any;
  encryptionOperations: any;
}

export class TelemetryService {
  private meter: any;
  private tracer: any;
  private metrics: MetricsCollector;
  private isInitialized = false;

  constructor() {
    this.initializeSDK();
  }

  /**
   * Initialize OpenTelemetry SDK
   */
  private initializeSDK(): void {
    const config = getConfig();
    
    // Create resource identification
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'ai-sales-platform',
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
      [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.env.HOSTNAME || 'unknown'
    });

    // Initialize SDK with auto-instrumentation
    const sdk = new NodeSDK({
      resource,
      instrumentations: [], // Auto-instruments HTTP, database, etc.
    });

    sdk.start();

    // Get meter and tracer
    this.meter = metrics.getMeter('ai-sales-platform', '1.0.0');
    this.tracer = trace.getTracer('ai-sales-platform', '1.0.0');

    this.initializeMetrics();
    this.isInitialized = true;

    console.log('📊 OpenTelemetry initialized for', config.environment);
  }

  /**
   * Initialize all metrics collectors
   */
  private initializeMetrics(): void {
    this.metrics = {
      // Meta API metrics
      metaRequestsTotal: this.meter.createCounter('meta_requests_total', {
        description: 'Total Meta API requests',
        unit: '1'
      }),
      
      metaLatency: this.meter.createHistogram('meta_latency_ms', {
        description: 'Meta API request latency',
        unit: 'ms',
        boundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000]
      }),
      
      metaRateLimited: this.meter.createCounter('meta_rate_limited_total', {
        description: 'Meta API rate limit hits',
        unit: '1'
      }),

      // Messaging metrics
      messagesTotal: this.meter.createCounter('messages_total', {
        description: 'Total messages processed',
        unit: '1'
      }),
      
      messagesSent: this.meter.createCounter('messages_sent_total', {
        description: 'Messages successfully sent',
        unit: '1'
      }),
      
      messagesDelivered: this.meter.createCounter('messages_delivered_total', {
        description: 'Messages confirmed delivered',
        unit: '1'
      }),
      
      messagesFailed: this.meter.createCounter('messages_failed_total', {
        description: 'Failed message deliveries',
        unit: '1'
      }),

      // Queue metrics
      queueJobsTotal: this.meter.createCounter('queue_jobs_total', {
        description: 'Total queue jobs processed',
        unit: '1'
      }),
      
      queueProcessingTime: this.meter.createHistogram('queue_processing_time_ms', {
        description: 'Queue job processing time',
        unit: 'ms',
        boundaries: [100, 500, 1000, 2500, 5000, 10000, 30000]
      }),
      
      queueDepth: this.meter.createUpDownCounter('queue_depth', {
        description: 'Current queue depth',
        unit: '1'
      }),
      
      dlqJobs: this.meter.createCounter('dlq_jobs_total', {
        description: 'Jobs sent to Dead Letter Queue',
        unit: '1'
      }),

      // Business metrics
      conversionsTotal: this.meter.createCounter('conversions_total', {
        description: 'Total conversation conversions',
        unit: '1'
      }),
      
      ordersTotal: this.meter.createCounter('orders_total', {
        description: 'Total orders created',
        unit: '1'
      }),
      
      revenueTotal: this.meter.createCounter('revenue_total', {
        description: 'Total revenue generated',
        unit: 'USD'
      }),
      
      merchantsActive: this.meter.createUpDownCounter('merchants_active', {
        description: 'Currently active merchants',
        unit: '1'
      }),

      // System metrics
      httpRequestsTotal: this.meter.createCounter('http_requests_total', {
        description: 'Total HTTP requests',
        unit: '1'
      }),
      
      httpRequestDuration: this.meter.createHistogram('http_request_duration_ms', {
        description: 'HTTP request duration',
        unit: 'ms',
        boundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500]
      }),
      
      databaseConnections: this.meter.createUpDownCounter('database_connections', {
        description: 'Active database connections',
        unit: '1'
      }),
      
      encryptionOperations: this.meter.createCounter('encryption_operations_total', {
        description: 'Total encryption/decryption operations',
        unit: '1'
      })
    };
  }

  /**
   * Record Meta API request
   */
  recordMetaRequest(
    platform: 'instagram' | 'whatsapp',
    endpoint: string,
    status: number,
    latencyMs: number,
    rateLimited = false
  ): void {
    const labels = { platform, endpoint, status: status.toString() };
    
    this.metrics.metaRequestsTotal.add(1, labels);
    this.metrics.metaLatency.record(latencyMs, labels);
    
    if (rateLimited) {
      this.metrics.metaRateLimited.add(1, { platform, endpoint });
    }
  }

  /**
   * Record message metrics
   */
  recordMessage(
    platform: 'WHATSAPP' | 'INSTAGRAM',
    direction: 'incoming' | 'outgoing',
    status: 'sent' | 'delivered' | 'failed',
    merchantId: string
  ): void {
    const labels = { platform, direction, merchant_id: merchantId };
    
    this.metrics.messagesTotal.add(1, labels);
    
    switch (status) {
      case 'sent':
        this.metrics.messagesSent.add(1, labels);
        break;
      case 'delivered':
        this.metrics.messagesDelivered.add(1, labels);
        break;
      case 'failed':
        this.metrics.messagesFailed.add(1, labels);
        break;
    }
  }

  /**
   * Record queue job metrics
   */
  recordQueueJob(
    jobType: string,
    status: 'completed' | 'failed' | 'dlq',
    processingTimeMs: number,
    merchantId?: string
  ): void {
    const labels = { 
      job_type: jobType, 
      status,
      ...(merchantId && { merchant_id: merchantId })
    };
    
    this.metrics.queueJobsTotal.add(1, labels);
    
    if (status === 'completed' || status === 'failed') {
      this.metrics.queueProcessingTime.record(processingTimeMs, labels);
    }
    
    if (status === 'dlq') {
      this.metrics.dlqJobs.add(1, { job_type: jobType });
    }
  }

  /**
   * Update queue depth
   */
  updateQueueDepth(depth: number, jobType?: string): void {
    const labels = jobType ? { job_type: jobType } : {};
    this.metrics.queueDepth.add(depth, labels);
  }

  /**
   * Record business conversion
   */
  recordConversion(
    merchantId: string,
    platform: 'WHATSAPP' | 'INSTAGRAM',
    orderValue?: number
  ): void {
    const labels = { merchant_id: merchantId, platform };
    
    this.metrics.conversionsTotal.add(1, labels);
    
    if (orderValue) {
      this.metrics.revenueTotal.add(orderValue, labels);
    }
  }

  /**
   * Record order creation
   */
  recordOrder(
    merchantId: string,
    orderValue: number,
    source: 'WHATSAPP' | 'INSTAGRAM' | 'MANUAL'
  ): void {
    const labels = { merchant_id: merchantId, source };
    
    this.metrics.ordersTotal.add(1, labels);
    this.metrics.revenueTotal.add(orderValue, labels);
  }

  /**
   * Update active merchants count
   */
  updateActiveMerchants(delta: number, tier?: string): void {
    const labels = tier ? { tier } : {};
    this.metrics.merchantsActive.add(delta, labels);
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(
    method: string,
    route: string,
    status: number,
    durationMs: number
  ): void {
    const labels = { method, route, status: status.toString() };
    
    this.metrics.httpRequestsTotal.add(1, labels);
    this.metrics.httpRequestDuration.record(durationMs, labels);
  }

  /**
   * Record encryption operation
   */
  recordEncryption(operation: 'encrypt' | 'decrypt', success: boolean): void {
    const labels = { operation, status: success ? 'success' : 'failure' };
    this.metrics.encryptionOperations.add(1, labels);
  }

  /**
   * Create custom trace span
   */
  createSpan<T>(name: string, operation: () => Promise<T>, attributes?: Record<string, any>): Promise<T> {
    return this.tracer.startActiveSpan(name, { attributes }, async (span: any) => {
      try {
        const result = await operation();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message }); // ERROR
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Add custom attributes to current span
   */
  addSpanAttributes(attributes: Record<string, any>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      Object.entries(attributes).forEach(([key, value]) => {
        activeSpan.setAttribute(key, value);
      });
    }
  }

  /**
   * Get current trace context for propagation
   */
  getCurrentTraceContext(): any {
    return trace.setSpanContext(context.active(), trace.getActiveSpan()?.spanContext() || {});
  }

  /**
   * Health check for telemetry system
   */
  healthCheck(): { status: 'healthy' | 'unhealthy'; details: any } {
    return {
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.isInitialized,
        metricsCount: Object.keys(this.metrics || {}).length,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Singleton instance
let telemetryInstance: TelemetryService | null = null;

/**
 * Get telemetry service instance
 */
export function getTelemetryService(): TelemetryService {
  if (!telemetryInstance) {
    telemetryInstance = new TelemetryService();
  }
  return telemetryInstance;
}

/**
 * Express/Hono middleware for automatic HTTP metrics
 */
export function telemetryMiddleware() {
  const telemetry = getTelemetryService();
  
  return async (c: any, next: any) => {
    const startTime = Date.now();
    const method = c.req.method;
    const route = c.req.routePath || c.req.url;
    
    await next();
    
    const duration = Date.now() - startTime;
    const status = c.res.status || 200;
    
    telemetry.recordHttpRequest(method, route, status, duration);
  };
}

// Export convenience functions
export const telemetry = getTelemetryService();
export default TelemetryService;