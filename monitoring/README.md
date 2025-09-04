# AI Sales Platform - Monitoring Setup

This directory contains the complete monitoring infrastructure for the AI Sales Platform, including Prometheus, Grafana, AlertManager, and Node Exporter configurations.

## 🏗️ Architecture

```
AI Sales Platform (Port 10000)
    │
    ├── /metrics endpoint (OpenTelemetry + Prometheus)
    │
    └── Monitoring Stack
        ├── Prometheus (Port 9090) - Metrics collection & storage
        ├── Grafana (Port 3000) - Visualization dashboards
        ├── AlertManager (Port 9093) - Alert routing & notification
        └── Node Exporter (Port 9100) - System metrics
```

## 🚀 Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed
- AI Sales Platform running on port 10000
- Ports 3000, 9090, 9093, 9100 available

### 2. Start Monitoring Stack
```bash
# Option 1: Use the provided script (recommended)
./scripts/start-monitoring.sh

# Option 2: Manual Docker Compose
docker-compose -f docker-compose.monitoring.yml up -d
```

### 3. Access Dashboards
- **Grafana**: http://localhost:3000 (admin/admin123)
- **Prometheus**: http://localhost:9090
- **AlertManager**: http://localhost:9093

## 📁 Directory Structure

```
monitoring/
├── README.md                          # This file
├── prometheus.yml                     # Prometheus configuration
├── alert.rules.yml                    # Alert rules definition
├── alertmanager.yml                   # AlertManager configuration
└── grafana/
    ├── provisioning/
    │   ├── datasources/
    │   │   └── prometheus.yml         # Auto-configure Prometheus datasource
    │   └── dashboards/
    │       └── dashboard.yml          # Dashboard provisioning config
    └── dashboards/
        └── ai-sales-platform.json     # Main monitoring dashboard
```

## ⚙️ Configuration Details

### Prometheus Configuration
- **Scrape Interval**: 15 seconds
- **Evaluation Interval**: 15 seconds
- **Data Retention**: 200 hours
- **Targets**: 
  - AI Sales Platform: `host.docker.internal:10000/metrics`
  - Node Exporter: `nodeexporter:9100`
  - Self-monitoring: Prometheus and Grafana

### Grafana Provisioning
- **Auto-configured datasource**: Prometheus connection
- **Pre-loaded dashboard**: AI Sales Platform comprehensive monitoring
- **Admin credentials**: admin/admin123 (change in production!)

### AlertManager Rules
- **Critical alerts**: Queue failures, service down, high memory/CPU
- **Warning alerts**: Queue stalling, AI service errors, performance degradation
- **Notification channels**: Webhook to main application + Slack integration

## 📊 Available Metrics

### Queue System Metrics
- Queue depth and processing status
- Job processing times (histograms)
- Error rates and failed job counts
- Dead Letter Queue monitoring
- Worker health status

### AI Services Metrics
- Extended Thinking processing times
- Predictive Analytics performance
- ManyChat integration metrics
- Intent classification rates
- Response confidence levels

### Business Intelligence
- Message processing rates
- Conversation creation metrics
- Service usage patterns
- KPI tracking (price hits, handoffs, etc.)

### Infrastructure Metrics
- CPU, memory, disk usage
- Network performance
- Docker container health
- Database and Redis performance

## 🚨 Alert Configuration

### Critical Alerts (Immediate Action Required)
- `QueueCriticalFailure`: Queue system failure
- `ServiceDown`: Main service unavailable
- `HighMemoryUsage`: Memory usage >90%
- `DiskSpaceLow`: Disk space <10%

### Warning Alerts (Investigation Needed)
- `QueueStalled`: Jobs waiting but not processing
- `DeadLetterQueueGrowing`: Failed jobs accumulating
- `AIServiceHighErrorRate`: AI service errors increasing
- `LowAIConfidenceRate`: AI confidence dropping

### Performance Alerts
- `ManyChatJobProcessingSlowdown`: P95 processing time >30s
- `ExtendedThinkingSlowPerformance`: P95 thinking time >10s
- `QueueHighErrorRate`: Error rate >20%
- `QueueBacklogBuilding`: >100 waiting jobs

## 🔧 Maintenance

### Stopping the Monitoring Stack
```bash
docker-compose -f docker-compose.monitoring.yml down
```

### Viewing Logs
```bash
# All services
docker-compose -f docker-compose.monitoring.yml logs -f

# Specific service
docker-compose -f docker-compose.monitoring.yml logs -f prometheus
```

### Restarting Services
```bash
# Restart all
docker-compose -f docker-compose.monitoring.yml restart

# Restart specific service
docker-compose -f docker-compose.monitoring.yml restart grafana
```

### Data Persistence
- **Prometheus data**: `prometheus_data` Docker volume
- **Grafana data**: `grafana_data` Docker volume  
- **AlertManager data**: `alertmanager_data` Docker volume

### Backup and Recovery
```bash
# Backup volumes
docker run --rm -v prometheus_data:/data -v $(pwd):/backup alpine tar czf /backup/prometheus_backup.tar.gz /data

# Restore volumes
docker run --rm -v prometheus_data:/data -v $(pwd):/backup alpine tar xzf /backup/prometheus_backup.tar.gz -C /
```

## 🔐 Security Considerations

### Production Deployment
1. **Change default passwords**: Update Grafana admin credentials
2. **Configure HTTPS**: Set up SSL certificates for web interfaces
3. **Network security**: Restrict access to monitoring ports
4. **Authentication**: Integrate with corporate SSO if available
5. **Alert channels**: Configure secure notification webhooks

### Environment Variables for Production
```bash
# In .env file
GRAFANA_ADMIN_PASSWORD=secure_password_here
PROMETHEUS_RETENTION_TIME=720h
ALERTMANAGER_WEBHOOK_PASSWORD=secure_webhook_password
```

## 📈 Dashboard Usage

### Key Performance Indicators
- **Queue Health**: Error rate <5%, processing time <30s
- **AI Performance**: Extended thinking <10s, high confidence >50%
- **System Health**: CPU <80%, Memory <85%, Disk >20%

### Customization
- **Add new metrics**: Edit Prometheus configuration
- **Create custom dashboards**: Import/create in Grafana
- **Modify alerts**: Update `alert.rules.yml` and reload Prometheus

## 🆘 Troubleshooting

### Common Issues

#### Metrics Not Appearing
1. Check if main application is exposing `/metrics` endpoint
2. Verify Prometheus can reach `host.docker.internal:10000`
3. Check Docker network configuration

#### Grafana Dashboard Empty
1. Verify Prometheus datasource connection in Grafana
2. Check if metrics are being scraped by Prometheus
3. Validate dashboard panel queries

#### Alerts Not Firing
1. Check alert rule syntax in `alert.rules.yml`
2. Verify AlertManager configuration
3. Test notification channels

### Health Checks
```bash
# Check if services are responding
curl http://localhost:9090/-/healthy    # Prometheus
curl http://localhost:3000/api/health   # Grafana
curl http://localhost:9093/-/healthy    # AlertManager
curl http://localhost:10000/metrics     # Main application
```

## 📚 Additional Resources

- [Metrics Catalog](../docs/METRICS_CATALOG.md) - Complete metrics reference
- [Dashboard Usage Guide](../docs/DASHBOARD_USAGE_GUIDE.md) - How to use Grafana dashboards
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)

## 🎯 Monitoring Best Practices

1. **Monitor the monitors**: Ensure monitoring infrastructure health
2. **Alert fatigue**: Keep alert thresholds meaningful to avoid noise
3. **Regular reviews**: Analyze trends and adjust thresholds
4. **Documentation**: Keep runbooks updated for alert responses
5. **Testing**: Regularly test alert notifications and recovery procedures

This monitoring setup provides comprehensive observability into the AI Sales Platform, enabling proactive issue detection and performance optimization.