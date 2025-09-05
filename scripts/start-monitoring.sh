#!/bin/bash

# AI Sales Platform - Monitoring Stack Startup Script
# This script starts the complete monitoring infrastructure

set -e

echo "🚀 Starting AI Sales Platform Monitoring Stack..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Warning: docker-compose not found, trying docker compose...${NC}"
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Create necessary directories
echo -e "${BLUE}📁 Creating monitoring directories...${NC}"
mkdir -p monitoring/grafana/dashboards
mkdir -p monitoring/grafana/provisioning/datasources
mkdir -p monitoring/grafana/provisioning/dashboards

# Check if the main application is running
if ! curl -s http://localhost:10000/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Warning: AI Sales Platform main service is not accessible at localhost:10000${NC}"
    echo -e "${YELLOW}Make sure the main application is running before starting monitoring${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Cancelled by user${NC}"
        exit 1
    fi
fi

# Start the monitoring stack
echo -e "${BLUE}🐳 Starting monitoring containers...${NC}"
$COMPOSE_CMD -f docker-compose.monitoring.yml up -d

# Wait for services to start
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check service health
echo -e "${BLUE}🔍 Checking service health...${NC}"

# Check Prometheus
if curl -s http://localhost:9090/-/ready >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Prometheus is ready${NC}"
else
    echo -e "${RED}❌ Prometheus is not responding${NC}"
fi

# Check Grafana
if curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Grafana is ready${NC}"
else
    echo -e "${RED}❌ Grafana is not responding${NC}"
fi

# Check AlertManager
if curl -s http://localhost:9093/-/ready >/dev/null 2>&1; then
    echo -e "${GREEN}✅ AlertManager is ready${NC}"
else
    echo -e "${RED}❌ AlertManager is not responding${NC}"
fi

# Check Node Exporter
if curl -s http://localhost:9100/metrics >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Node Exporter is ready${NC}"
else
    echo -e "${RED}❌ Node Exporter is not responding${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Monitoring stack started successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Access URLs:${NC}"
echo -e "  Grafana Dashboard: ${YELLOW}http://localhost:3000${NC} (admin/admin123)"
echo -e "  Prometheus: ${YELLOW}http://localhost:9090${NC}"
echo -e "  AlertManager: ${YELLOW}http://localhost:9093${NC}"
echo -e "  Node Exporter: ${YELLOW}http://localhost:9100/metrics${NC}"
echo ""
echo -e "${BLUE}📈 Metrics Endpoint:${NC}"
echo -e "  AI Sales Platform: ${YELLOW}http://localhost:10000/metrics${NC}"
echo ""
echo -e "${BLUE}🔧 Useful Commands:${NC}"
echo -e "  View logs: ${YELLOW}$COMPOSE_CMD -f docker-compose.monitoring.yml logs -f${NC}"
echo -e "  Stop monitoring: ${YELLOW}$COMPOSE_CMD -f docker-compose.monitoring.yml down${NC}"
echo -e "  Restart monitoring: ${YELLOW}$COMPOSE_CMD -f docker-compose.monitoring.yml restart${NC}"
echo ""
echo -e "${GREEN}Happy monitoring! 🚀${NC}"