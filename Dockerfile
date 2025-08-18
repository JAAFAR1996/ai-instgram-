# ========================================
# AI Sales Platform - Production Docker
# Production-Grade Multi-stage Build
# ========================================

# Build Stage
FROM node:20.18.1-alpine AS builder

# Security: Install only required system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Lock npm version for reproducible builds
RUN npm install -g npm@10.9.2

# Copy dependency files first (Docker layer caching)
COPY package*.json ./
COPY tsconfig*.json ./

# Production dependencies installation with validation
RUN npm ci --omit=dev --no-audit --no-fund --quiet \
    && npm cache clean --force \
    && npm audit --omit=dev

# Copy source code
COPY src/ ./src/

# Build application with type checking
RUN npm run typecheck && npm run build

# Remove dev dependencies from final image
RUN rm -rf src/ tsconfig*.json

# ========================================
# Production Stage
FROM node:20.18.1-alpine AS production

# Security labels
LABEL maintainer="jaafarhabash@yahoo.com"
LABEL version="1.0.0"
LABEL description="AI Sales Platform - Production"

# Create non-root user with specific IDs
RUN addgroup -g 1001 -S nodejs && \
    adduser -S aiuser -u 1001 -G nodejs

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    dumb-init \
    tini \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy built application with proper ownership
COPY --from=builder --chown=aiuser:nodejs /app/dist ./dist
COPY --from=builder --chown=aiuser:nodejs /app/node_modules ./node_modules
COPY --chown=aiuser:nodejs package*.json ./

# Create logs directory
RUN mkdir -p /app/logs && chown aiuser:nodejs /app/logs

# Health check with proper timeout
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Security: Drop root privileges
USER aiuser

# Environment optimization
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024 --optimize-for-size"
ENV PORT=3000
ENV UV_THREADPOOL_SIZE=4

# Expose port
EXPOSE 3000

# Use tini as init system for proper signal handling
ENTRYPOINT ["tini", "--", "dumb-init", "--"]
CMD ["node", "--max-old-space-size=1024", "dist/production-index.js"]

# Multi-architecture build support
# docker buildx build --platform linux/amd64,linux/arm64 -t ai-sales-platform .