# =================================
# AI Sales Platform - Production
# Multi-stage Docker Build
# =================================

# Build Stage
FROM node:20-alpine AS builder

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build application
RUN npm run build

# Production Stage
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S aiuser -u 1001

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    dumb-init

WORKDIR /app

# Copy built application
COPY --from=builder --chown=aiuser:nodejs /app/dist ./dist
COPY --from=builder --chown=aiuser:nodejs /app/node_modules ./node_modules
COPY --chown=aiuser:nodejs package*.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Security settings
USER aiuser

# Environment
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/production-index.js"]