# AI Sales Platform - Dashboard Usage Guide

This guide provides comprehensive instructions for using the monitoring dashboards and understanding the metrics visualizations.

## 🚀 Quick Start

### Starting the Monitoring Stack

1. **Start the main application** (ensure it's running on port 10000)
2. **Run the monitoring script**:
   ```bash
   ./scripts/start-monitoring.sh
   ```
3. **Access Grafana**: http://localhost:3000
   - Username: `admin`
   - Password: `admin123`

### Key URLs
- **Grafana Dashboard**: http://localhost:3000
- **Prometheus**: http://localhost:9090
- **AlertManager**: http://localhost:9093
- **AI Sales Platform Metrics**: http://localhost:10000/metrics

## 📊 Dashboard Overview

### AI Sales Platform - Comprehensive Monitoring Dashboard

The main dashboard provides six key visualization panels:

#### 1. Queue Status (Top Left)
**What it shows**: Real-time queue activity
- **Waiting Jobs** (Blue): Jobs queued for processing
- **Active Jobs** (Green): Jobs currently being processed  
- **Failed Jobs** (Red): Jobs that failed processing

**How to interpret**:
- Healthy: Waiting jobs should be processed quickly, active jobs indicate system activity
- Warning: Waiting jobs consistently > 50 may indicate capacity issues
- Alert: Failed jobs accumulating indicates systemic problems

#### 2. Queue Error Rate (Top Right)
**What it shows**: Current error percentage as a gauge
- **Green Zone** (0-5%): Healthy operation
- **Yellow Zone** (5-20%): Elevated errors, monitor closely
- **Red Zone** (>20%): Critical error rate requiring immediate attention

**How to interpret**:
- Normal: <5% error rate is expected due to network issues, invalid requests
- Concerning: 5-20% suggests potential issues with processing logic
- Critical: >20% indicates major system problems

#### 3. Job Processing Time (Middle Left)
**What it shows**: Performance histograms
- **95th Percentile** (Orange): 95% of jobs complete within this time
- **50th Percentile** (Blue): Median processing time

**How to interpret**:
- Target: P95 should be <30 seconds for good user experience
- Warning: P95 >30 seconds indicates performance degradation
- Investigation: Large gap between P50 and P95 suggests inconsistent performance

#### 4. AI Services Usage Rate (Middle Right)
**What it shows**: AI service request rates per second
- **Extended Thinking Requests/sec**: Advanced AI reasoning requests
- **Intent Classifications/sec**: Message intent detection rate

**How to interpret**:
- Growth indicator: Increasing rates show platform adoption
- Capacity planning: High rates may require AI service scaling
- Business insight: Patterns show peak usage times

#### 5. Queue Health Issues (Bottom Left)
**What it shows**: Problematic queue states
- **Dead Letter Queue Size**: Failed jobs requiring manual review
- **Stalled Jobs**: Jobs stuck in processing

**How to interpret**:
- Target: Both should be near zero
- Warning: DLQ >10 requires investigation of failure patterns
- Critical: Stalled jobs indicate worker health issues

#### 6. AI Processing Performance (Bottom Right)
**What it shows**: AI service response times (95th percentile)
- **Extended Thinking P95**: Advanced reasoning performance
- **Predictive Analytics P95**: ML prediction performance

**How to interpret**:
- Target: Extended Thinking <10s, Predictive Analytics <5s
- Optimization: Spikes indicate model performance issues
- Capacity: Consistently high times suggest need for optimization

## 🔍 Advanced Usage

### Custom Time Ranges
- **Last 5 minutes**: Real-time troubleshooting
- **Last 1 hour**: Current performance analysis
- **Last 24 hours**: Daily pattern identification
- **Last 7 days**: Weekly trend analysis

### Using Variables and Filters
The dashboard supports merchant-specific filtering:
1. Click the variable dropdown (if available)
2. Select specific merchant IDs to focus analysis
3. Use "All" to see aggregate data

### Zoom and Pan
- **Zoom**: Click and drag across any time series
- **Pan**: Hold Shift and click-drag to move time window
- **Reset**: Double-click to return to original view

## 🚨 Alert Integration

### Alert States in Grafana
- **Green**: Normal operation, no alerts
- **Yellow**: Warning alerts active
- **Red**: Critical alerts firing

### Alert Annotations
- Alert markers appear as vertical lines on graphs
- Click markers to see alert details
- Use alert history to correlate incidents with metrics

### Silence Management
Navigate to AlertManager (http://localhost:9093) to:
- View active alerts
- Create silences for maintenance
- Configure notification channels

## 📈 Business Intelligence

### Key Performance Indicators (KPIs)

Create additional panels to track:
```promql
# Conversion Rate: High confidence responses
rate(ai_sales_manychat_high_confidence_responses_total[1h]) / rate(ai_sales_manychat_intent_classified_total[1h])

# Processing Efficiency: Completed vs Total
rate(ai_sales_queue_operations_total{operation="completed"}[1h]) / rate(ai_sales_queue_operations_total[1h])

# AI Utilization: Extended thinking usage
sum(rate(ai_sales_extended_thinking_requests_total[1h])) by (merchant_id)
```

### Merchant Analysis
Filter by merchant ID to:
- Compare performance across merchants
- Identify high-usage merchants
- Analyze merchant-specific error patterns

## 🔧 Customization

### Adding New Panels
1. Click "Add Panel" in dashboard edit mode
2. Select visualization type (Time series, Gauge, Stat, etc.)
3. Configure query using metrics from [Metrics Catalog](METRICS_CATALOG.md)
4. Set appropriate thresholds and alerts

### Panel Configuration Best Practices
- **Time Series**: Use for trends and patterns
- **Gauge**: Use for current state (error rates, utilization)
- **Stat**: Use for counters and totals
- **Heatmap**: Use for distribution analysis

### Custom Alerts
Create dashboard-specific alerts:
1. Edit panel → Alert tab
2. Set conditions based on query results
3. Configure notification channels
4. Test alert rules before deploying

## 🚨 Troubleshooting Scenarios

### Scenario 1: Queue Backlog Building
**Symptoms**: Waiting jobs increasing, processing time stable
**Investigation**:
1. Check active jobs - are workers processing?
2. Review error rate - are jobs failing?
3. Examine processing time trends - performance degradation?
**Actions**: Scale workers, investigate failed jobs

### Scenario 2: High Error Rate
**Symptoms**: Error rate >20%, failed jobs accumulating
**Investigation**:
1. Check DLQ for error patterns
2. Review AI service performance metrics
3. Check external service (Meta API) rates
**Actions**: Review logs, check service dependencies

### Scenario 3: Slow AI Performance
**Symptoms**: Extended thinking P95 >10s
**Investigation**:
1. Check AI service usage rate - overloaded?
2. Review merchant distribution - specific merchant issues?
3. Examine processing complexity - more steps?
**Actions**: Optimize AI prompts, scale AI services

### Scenario 4: Processing Stalling
**Symptoms**: Active jobs stuck, no completions
**Investigation**:
1. Check stalled jobs metric
2. Review worker health monitoring
3. Examine database and Redis performance
**Actions**: Restart workers, check dependencies

## 📊 Performance Optimization

### Monitoring Performance
Use these queries to identify optimization opportunities:

```promql
# Slowest processing by merchant
topk(10, histogram_quantile(0.95, sum(rate(ai_sales_queue_processing_duration_ms_bucket[5m])) by (merchant_id, le)))

# Most error-prone operations
topk(10, rate(ai_sales_queue_operations_total{operation="failed"}[1h]) by (job_type))

# Cache hit rates (if cached field available)
sum(rate(ai_sales_queue_processing_duration_ms_count{cached="true"}[1h])) / sum(rate(ai_sales_queue_processing_duration_ms_count[1h]))
```

### Capacity Planning
Monitor these trends for scaling decisions:
- Queue depth growth over time
- Processing time percentile trends
- AI service usage patterns
- Error rate patterns

## 🔐 Security and Access

### Dashboard Permissions
- **Admin**: Full access to edit dashboards and alerts
- **Editor**: Can modify panels and queries
- **Viewer**: Read-only access to dashboards

### Data Retention
- **Prometheus**: 200 hours (default configuration)
- **Grafana**: Unlimited dashboard storage
- **AlertManager**: 120 hours alert history

### Backup and Recovery
Regular backup recommendations:
- Export dashboard JSON configurations
- Backup Prometheus data volume
- Document custom alert rules

## 📚 Additional Resources

### Related Documentation
- [Metrics Catalog](METRICS_CATALOG.md) - Complete metrics reference
- [Alert Rules Reference](../monitoring/alert.rules.yml) - All configured alerts
- [OpenTelemetry Configuration](../src/services/telemetry.ts) - Metrics implementation

### Useful Prometheus Functions
- `rate()`: Per-second rate over time range
- `histogram_quantile()`: Calculate percentiles
- `increase()`: Total increase over time range
- `avg_over_time()`: Average value over time range
- `topk()`: Top K values
- `sum() by()`: Group and sum metrics

### Grafana Features
- **Annotations**: Mark deployments and incidents
- **Variables**: Dynamic dashboard filtering
- **Alerts**: Automated notification system
- **Plugins**: Extend visualization capabilities

This dashboard provides comprehensive visibility into the AI Sales Platform's health, performance, and business metrics. Use it proactively to maintain system reliability and optimize performance.