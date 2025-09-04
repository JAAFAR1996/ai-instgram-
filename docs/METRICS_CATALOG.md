# AI Sales Platform - Metrics Catalog

This document provides a comprehensive overview of all metrics available in the AI Sales Platform telemetry system.

## 📊 Overview

The AI Sales Platform implements a comprehensive OpenTelemetry-based monitoring system with Prometheus exporters and Grafana dashboards. All metrics use the `ai_sales_` prefix.

## 🗂️ Metric Categories

### 1. Queue System Metrics

#### Core Queue Operations
- **`ai_sales_queue_operations_total`** (Counter)
  - **Description**: Total number of queue operations (add, process, completed, failed)
  - **Labels**: `operation` (add|process|completed|failed), `queue`
  - **Use Case**: Track job throughput and queue activity patterns

#### Queue Depth & Status
- **`ai_sales_queue_depth`** (Gauge)
  - **Description**: Current total depth of the queue (waiting + active jobs)
  - **Use Case**: Monitor queue backlog and capacity planning

- **`ai_sales_queue_active_jobs`** (Gauge)
  - **Description**: Number of jobs currently being processed
  - **Use Case**: Monitor worker utilization

- **`ai_sales_queue_waiting_jobs`** (Gauge)
  - **Description**: Number of jobs waiting to be processed
  - **Use Case**: Detect queue buildup and processing delays

- **`ai_sales_queue_error_rate_percent`** (Gauge)
  - **Description**: Current error rate as a percentage
  - **Use Case**: Monitor system health and job success rates

#### Queue Processing Performance
- **`ai_sales_queue_processing_duration_ms`** (Histogram)
  - **Description**: Time taken to process individual jobs
  - **Labels**: `job_type` (manychat), `merchant_id`, `success`, `has_images`, `cached`
  - **Buckets**: Configured for millisecond-level processing times
  - **Use Case**: Performance optimization and SLA monitoring

#### Queue Health Monitoring
- **`ai_sales_queue_monitoring_total_jobs`** (Gauge)
  - **Description**: Total jobs in all queue states
  - **Use Case**: System capacity overview

- **`ai_sales_queue_monitoring_waiting_jobs`** (Gauge)
  - **Description**: Jobs waiting to be processed (monitoring perspective)
  - **Use Case**: Real-time queue status monitoring

- **`ai_sales_queue_monitoring_active_jobs`** (Gauge)
  - **Description**: Jobs currently being processed (monitoring perspective)
  - **Use Case**: Active processing monitoring

- **`ai_sales_queue_monitoring_failed_jobs`** (Gauge)
  - **Description**: Total failed jobs count
  - **Use Case**: Error tracking and recovery monitoring

- **`ai_sales_queue_monitoring_completed_jobs`** (Gauge)
  - **Description**: Total completed jobs count
  - **Use Case**: Throughput and success tracking

- **`ai_sales_queue_monitoring_delayed_jobs`** (Gauge)
  - **Description**: Jobs scheduled for future processing
  - **Use Case**: Scheduled job monitoring

- **`ai_sales_queue_monitoring_error_rate`** (Gauge)
  - **Description**: Current error rate percentage from monitoring system
  - **Use Case**: Health dashboard displays

#### Dead Letter Queue (DLQ) Metrics
- **`ai_sales_queue_dlq_jobs_total`** (Counter)
  - **Description**: Total number of jobs moved to Dead Letter Queue
  - **Use Case**: Track job failures requiring manual intervention

- **`ai_sales_queue_dlq_current_count`** (Gauge)
  - **Description**: Current number of jobs in the Dead Letter Queue
  - **Use Case**: Monitor failed job accumulation

- **`ai_sales_queue_dlq_by_error_type_total`** (Counter)
  - **Description**: DLQ jobs categorized by error type
  - **Labels**: `error_type` (timeout|network|database|ai_service|unknown), `queue`
  - **Use Case**: Root cause analysis of job failures

#### Queue Critical Issues
- **`ai_sales_queue_stalled_detection_total`** (Counter)
  - **Description**: Number of times queue stalling was detected
  - **Use Case**: Identify worker health issues

- **`ai_sales_queue_critical_failure_total`** (Counter)
  - **Description**: Critical queue failures requiring restart
  - **Labels**: `waiting_jobs`, `active_jobs`, `time_since_last_process`
  - **Use Case**: Track severe system issues

- **`ai_sales_queue_stalled_jobs_total`** (Counter)
  - **Description**: Total count of jobs that became stalled
  - **Use Case**: Monitor job processing issues

- **`ai_sales_queue_stalled_jobs_current`** (Gauge)
  - **Description**: Current number of stalled jobs
  - **Use Case**: Real-time stalled job monitoring

- **`ai_sales_queue_monitoring_errors_total`** (Counter)
  - **Description**: Errors in the queue monitoring system itself
  - **Use Case**: Monitor monitoring system health

### 2. AI Services Metrics

#### Extended Thinking Service
- **`ai_sales_extended_thinking_requests_total`** (Counter)
  - **Description**: Total requests to Extended Thinking service
  - **Labels**: `merchant_id`, `show_thinking`, `has_context`
  - **Use Case**: Track AI service usage patterns

- **`ai_sales_extended_thinking_processing_time_ms`** (Histogram)
  - **Description**: Processing time for Extended Thinking operations
  - **Labels**: `merchant_id`, `steps_completed`, `has_summary`
  - **Use Case**: Performance monitoring and optimization

- **`ai_sales_extended_thinking_stages_completed_total`** (Counter)
  - **Description**: Individual thinking stages completed
  - **Labels**: `stage` (ANALYZE|EXPLORE|EVALUATE|DECIDE), `merchant_id`
  - **Use Case**: Track thinking process completion rates

#### Predictive Analytics
- **`ai_sales_predictive_analytics_size_predictions_total`** (Counter)
  - **Description**: Total size issue predictions requested
  - **Labels**: `merchant_id`, `has_proposed_product`, `has_proposed_size`
  - **Use Case**: Track predictive service usage

- **`ai_sales_predictive_analytics_processing_time_ms`** (Histogram)
  - **Description**: Processing time for predictive analytics
  - **Labels**: `prediction_type`, `merchant_id`, `risk_level`, `confidence_range`
  - **Use Case**: Performance monitoring for ML services

- **`ai_sales_predictive_analytics_predictions_completed_total`** (Counter)
  - **Description**: Successfully completed predictions
  - **Labels**: `prediction_type`, `merchant_id`, `risk_level`
  - **Use Case**: Track prediction success rates

- **`ai_sales_predictive_analytics_errors_total`** (Counter)
  - **Description**: Errors in predictive analytics processing
  - **Labels**: `prediction_type`, `merchant_id`, `error_type`
  - **Use Case**: Error tracking for ML services

#### ManyChat Integration
- **`ai_sales_manychat_intent_classified_total`** (Counter)
  - **Description**: Total intents classified for ManyChat messages
  - **Labels**: `intent`, `merchant_id`
  - **Use Case**: Track AI intent recognition performance

- **`ai_sales_manychat_high_confidence_responses_total`** (Counter)
  - **Description**: AI responses with high confidence (≥0.8)
  - **Labels**: `merchant_id`
  - **Use Case**: Monitor AI response quality

- **`ai_sales_manychat_processing_errors_total`** (Counter)
  - **Description**: Errors in ManyChat message processing
  - **Labels**: `error_type`, `merchant_id`, `has_message`, `has_images`
  - **Use Case**: Track processing errors by context

### 3. Business & Application Metrics

#### Message Processing
- **`ai_sales_messages_processed_total`** (Counter)
  - **Description**: Total messages processed by the system
  - **Labels**: `platform` (instagram|whatsapp), `direction` (incoming|outgoing), `success`
  - **Use Case**: Track message throughput and success rates

- **`ai_sales_message_processing_latency_ms`** (Histogram)
  - **Description**: End-to-end message processing latency
  - **Labels**: `platform`, `direction`, `success`
  - **Use Case**: Monitor user experience and response times

#### Conversation Management
- **`ai_sales_conversations_total`** (Counter)
  - **Description**: Total conversations created
  - **Labels**: `platform`, `stage`, `merchant_id`
  - **Use Case**: Track business engagement metrics

#### Service Control
- **`ai_sales_service_toggles_total`** (Counter)
  - **Description**: Service enable/disable toggles by merchants
  - **Labels**: `merchant_id`, `service`, `enabled`
  - **Use Case**: Track feature adoption and usage patterns

#### Custom Events
- **`ai_sales_events_total`** (Counter)
  - **Description**: General-purpose custom event tracking
  - **Labels**: `name`, plus custom properties
  - **Use Case**: Track business-specific events and user actions

### 4. External Service Metrics

#### Meta API Integration
- **`ai_sales_meta_requests_total`** (Counter)
  - **Description**: Total requests to Meta API services
  - **Labels**: `platform`, `endpoint`, `status`
  - **Use Case**: Track API usage and success rates

- **`ai_sales_meta_latency_ms`** (Histogram)
  - **Description**: Meta API request latency
  - **Labels**: `platform`, `endpoint`, `status`
  - **Use Case**: Monitor external service performance

- **`ai_sales_meta_rate_limited_total`** (Counter)
  - **Description**: Rate limit hits from Meta API
  - **Labels**: `platform`, `endpoint`
  - **Use Case**: Track API rate limiting issues

#### AI Model Services
- **`ai_sales_ai_requests_total`** (Counter)
  - **Description**: Total requests to AI model services (OpenAI, etc.)
  - **Labels**: `model`, `success`
  - **Use Case**: Track AI service usage

- **`ai_sales_ai_latency_ms`** (Histogram)
  - **Description**: AI service request latency
  - **Labels**: `model`, `success`
  - **Use Case**: Monitor AI service performance

- **`ai_sales_ai_tokens_total`** (Counter)
  - **Description**: Total AI tokens consumed
  - **Labels**: `model`, `type` (total|prompt|completion)
  - **Use Case**: Cost tracking and usage optimization

#### Database Operations
- **`ai_sales_db_queries_total`** (Counter)
  - **Description**: Total database queries executed
  - **Labels**: `query_type`, `success`
  - **Use Case**: Track database usage patterns

- **`ai_sales_db_latency_ms`** (Histogram)
  - **Description**: Database query execution time
  - **Labels**: `query_type`, `success`
  - **Use Case**: Database performance monitoring

#### Redis Operations
- **`ai_sales_redis_operations_total`** (Counter)
  - **Description**: Total Redis operations
  - **Labels**: `operation`, `success`
  - **Use Case**: Cache and session management monitoring

- **`ai_sales_redis_latency_ms`** (Histogram)
  - **Description**: Redis operation latency
  - **Labels**: `operation`, `success`
  - **Use Case**: Cache performance optimization

- **`ai_sales_rate_limit_store_failures_total`** (Counter)
  - **Description**: Rate limit storage failures in Redis
  - **Labels**: `platform`, `endpoint`
  - **Use Case**: Monitor rate limiting system health

### 5. Key Performance Indicators (KPIs)

#### Business Intelligence
- **`ai_sales_kpi_price_hit_total`** (Counter)
  - **Description**: Successful price lookups from database
  - **Use Case**: Track product catalog effectiveness

- **`ai_sales_kpi_price_miss_total`** (Counter)
  - **Description**: Price lookups that resulted in suggestions
  - **Use Case**: Identify catalog gaps

- **`ai_sales_kpi_followup_total`** (Counter)
  - **Description**: Follow-up questions asked by AI
  - **Use Case**: Measure AI engagement effectiveness

- **`ai_sales_kpi_manager_handoff_total`** (Counter)
  - **Description**: Handoffs to human managers due to missing information
  - **Use Case**: Track automation vs human intervention ratio

- **`ai_sales_kpi_alt_suggest_total`** (Counter)
  - **Description**: Alternative product suggestions made
  - **Use Case**: Track AI recommendation effectiveness

## 📈 Dashboard Integration

### Grafana Dashboard Panels
1. **Queue Status Panel**: Real-time queue depth and processing status
2. **Queue Error Rate Gauge**: Visual error rate monitoring with thresholds
3. **Job Processing Time**: Histogram showing P50 and P95 processing times
4. **AI Services Usage Rate**: Request rates for AI services
5. **Queue Health Issues**: DLQ size and stalled job counts
6. **AI Processing Performance**: P95 response times for AI services

### Key Metrics for Alerting
- Queue error rate > 20%
- P95 processing time > 30 seconds
- DLQ size > 50 jobs
- Extended thinking P95 > 10 seconds
- AI confidence rate < 50%
- Queue stalling detection
- Critical queue failures

## 🚨 Alert Thresholds

### Critical Alerts (Immediate Attention)
- **QueueCriticalFailure**: Any occurrence
- **QueueHighErrorRate**: >20% for 2+ minutes
- **ServiceDown**: 30+ seconds
- **HighMemoryUsage**: >90% for 5+ minutes
- **DiskSpaceLow**: <10% remaining

### Warning Alerts (Investigation Needed)
- **QueueStalled**: Jobs waiting but no processing for 1+ minute
- **DeadLetterQueueGrowing**: >50 failed jobs for 5+ minutes
- **AIServiceHighErrorRate**: >0.1 errors/sec for 3+ minutes
- **LowAIConfidenceRate**: <50% high confidence for 10+ minutes

## 🔧 Configuration

All metrics are enabled by default when `METRICS_ENABLED=true` in the environment configuration. Individual metric categories can be controlled via:

- `TELEMETRY_QUEUE_METRICS=true`
- `TELEMETRY_AI_METRICS=true`
- `TELEMETRY_BUSINESS_METRICS=true`
- `TELEMETRY_PERFORMANCE_METRICS=true`

## 📊 Usage Examples

### Prometheus Queries

```promql
# Queue processing rate
rate(ai_sales_queue_operations_total{operation="completed"}[5m])

# Average processing time
histogram_quantile(0.50, ai_sales_queue_processing_duration_ms_bucket)

# Error rate calculation
(rate(ai_sales_queue_operations_total{operation="failed"}[5m]) / rate(ai_sales_queue_operations_total[5m])) * 100

# AI service usage by merchant
sum(rate(ai_sales_extended_thinking_requests_total[1h])) by (merchant_id)
```

This comprehensive metrics catalog enables full observability into the AI Sales Platform's performance, health, and business impact.