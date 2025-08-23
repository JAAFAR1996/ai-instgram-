import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import type { DIContainer } from '../container/index.js';
import type { AppConfig } from '../config/environment.js';

let _inited = false;
let meterProvider: MeterProvider | null = null;

export async function initTelemetry(config?: AppConfig): Promise<void> {
  if (_inited) return;
  
  // Set up diagnostics
  const diagLevel = process.env.NODE_ENV === 'development' ? DiagLogLevel.DEBUG : DiagLogLevel.ERROR;
  diag.setLogger(new DiagConsoleLogger(), diagLevel);
  
  // Create resource with service information
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'ai-sales-platform',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'production',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    })
  );
  
  // Initialize meter provider with resource
  meterProvider = new MeterProvider({ 
    resource,
    // Add readers/exporters here for Prometheus, etc.
  });
  
  _inited = true;
}

export function getMeter(name = 'ai-sales-platform') {
  if (!meterProvider) throw new Error('telemetry not initialized');
  return meterProvider.getMeter(name);
}

// Convenience counters
const counters = new Map<string, ReturnType<ReturnType<typeof getMeter>['createCounter']>>();
// Enhanced counter creation with better caching
export function counter(name: string, description?: string) {
  if (!counters.has(name)) {
    const m = getMeter();
    counters.set(name, m.createCounter(name, { description, unit: 'count' }));
  }
  return counters.get(name)!;
}

// Histogram creation helper
const histograms = new Map<string, ReturnType<ReturnType<typeof getMeter>['createHistogram']>>();
export function histogram(name: string, description?: string, unit?: string) {
  if (!histograms.has(name)) {
    const m = getMeter();
    histograms.set(name, m.createHistogram(name, { description, unit }));
  }
  return histograms.get(name)!;
}

// Gauge creation helper
const gauges = new Map<string, ReturnType<ReturnType<typeof getMeter>['createGauge']>>();
export function gauge(name: string, description?: string, unit?: string) {
  if (!gauges.has(name)) {
    const m = getMeter();
    gauges.set(name, m.createGauge(name, { description, unit }));
  }
  return gauges.get(name)!;
}

// Enhanced telemetry service with more comprehensive metrics
export const telemetry = {
  // Meta API metrics
  recordMetaRequest(platform: 'instagram'|'whatsapp', endpoint: string, status: number, latencyMs: number, rateLimited = false) {
    try {
      counter('meta_requests_total','Total Meta API requests').add(1,{ platform, endpoint, status: String(status) });
      getMeter().createHistogram('meta_latency_ms',{ description:'Meta API request latency' }).record(latencyMs,{ platform, endpoint, status:String(status) });
      if (rateLimited) counter('meta_rate_limited_total','Meta API rate limit hits').add(1,{ platform, endpoint });
    } catch {}
  },
  
  // Redis metrics
  recordRateLimitStoreFailure(platform: 'instagram'|'whatsapp', endpoint: string) {
    try {
      counter('rate_limit_store_failures_total','Redis rate limit store failures').add(1,{ platform, endpoint });
    } catch {}
  },
  
  recordRedisOperation(operation: string, success: boolean, latencyMs: number) {
    try {
      counter('redis_operations_total','Redis operations').add(1,{ operation, success: String(success) });
      getMeter().createHistogram('redis_latency_ms',{ description:'Redis operation latency' }).record(latencyMs,{ operation, success: String(success) });
    } catch {}
  },
  
  // Database metrics
  recordDatabaseQuery(query: string, success: boolean, latencyMs: number) {
    try {
      counter('db_queries_total','Database queries').add(1,{ query_type: query, success: String(success) });
      getMeter().createHistogram('db_latency_ms',{ description:'Database query latency' }).record(latencyMs,{ query_type: query, success: String(success) });
    } catch {}
  },
  
  // AI service metrics
  recordAIRequest(model: string, success: boolean, latencyMs: number, tokens?: { prompt: number; completion: number }) {
    try {
      counter('ai_requests_total','AI service requests').add(1,{ model, success: String(success) });
      getMeter().createHistogram('ai_latency_ms',{ description:'AI request latency' }).record(latencyMs,{ model, success: String(success) });
      if (tokens) {
        counter('ai_tokens_total','AI tokens used').add(tokens.prompt + tokens.completion,{ model, type: 'total' });
        counter('ai_tokens_total','AI tokens used').add(tokens.prompt,{ model, type: 'prompt' });
        counter('ai_tokens_total','AI tokens used').add(tokens.completion,{ model, type: 'completion' });
      }
    } catch {}
  },
  
  // Message processing metrics
  recordMessageProcessing(platform: 'instagram'|'whatsapp', direction: 'incoming'|'outgoing', success: boolean, latencyMs: number) {
    try {
      counter('messages_processed_total','Messages processed').add(1,{ platform, direction, success: String(success) });
      getMeter().createHistogram('message_processing_latency_ms',{ description:'Message processing latency' }).record(latencyMs,{ platform, direction, success: String(success) });
    } catch {}
  },
  
  // Queue metrics
  recordQueueOperation(queue: string, operation: 'add'|'process'|'failed'|'completed', count: number = 1) {
    try {
      counter('queue_operations_total','Queue operations').add(count,{ queue, operation });
    } catch {}
  },
  
  // Business metrics
  recordConversation(platform: 'instagram'|'whatsapp', stage: string, merchantId?: string) {
    try {
      counter('conversations_total','Conversations created').add(1,{ platform, stage, merchant_id: merchantId || 'unknown' });
    } catch {}
  },
  
  recordServiceControl(merchantId: string, service: string, enabled: boolean) {
    try {
      counter('service_toggles_total','Service control toggles').add(1,{ merchant_id: merchantId, service, enabled: String(enabled) });
    } catch {}
  },
  
  // Custom events
  trackEvent(name: string, props: Record<string, unknown> = {}) {
    try {
      counter('events_total','Custom events').add(1,{ name, ...Object.fromEntries(Object.entries(props).map(([k,v]) => [k, String(v)])) });
    } catch {}
  },
};
