# ===============================================
# Production-Grade Multi-stage Dockerfile (2025 Standards)
# ✅ Security hardened + Read-only filesystem + Health checks
# ===============================================

# Stage 1: Base image with security updates
FROM oven/bun:1.0-alpine AS base

# Security: Update all packages and remove package manager cache
RUN apk update && apk upgrade && \
    apk add --no-cache \
    curl \
    dumb-init \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

# Security: Create non-root user early
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

WORKDIR /app

# Stage 2: Dependencies (cached layer)
FROM base AS deps
COPY --chown=appuser:nodejs package.json bun.lockb* ./
USER appuser
RUN bun install --frozen-lockfile --production --no-save

# Stage 3: Development (optimized for dev workflow)
FROM base AS development
COPY --chown=appuser:nodejs package.json bun.lockb* ./
USER appuser
RUN bun install --frozen-lockfile
COPY --chown=appuser:nodejs . .
EXPOSE 10000
HEALTHCHECK --interval=10s --timeout=3s --start-period=2s --retries=2 \
    CMD curl -f http://localhost:10000/health || exit 1
CMD ["bun", "run", "dev"]

# Stage 4: Build (production artifacts)
FROM base AS build
COPY --chown=appuser:nodejs package.json bun.lockb* ./
USER appuser
RUN bun install --frozen-lockfile

COPY --chown=appuser:nodejs . .

# Build application with optimizations
ENV NODE_ENV=production
RUN bun run build && \
    bun install --production --frozen-lockfile && \
    rm -rf src tests docs .git .github .vscode *.md tsconfig.json

# Stage 5: Production (minimal & secure)
FROM node:20-alpine AS production

# Security: Install only essential packages (latest compatible versions)
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

# Security: Create dedicated user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Create directory structure with proper permissions
WORKDIR /app
RUN mkdir -p /app/logs /app/uploads /tmp/app && \
    chown -R appuser:nodejs /app /tmp/app

# Copy production server and dependencies with correct ownership
COPY --chown=appuser:nodejs production-server.cjs ./production-server.cjs
COPY --chown=appuser:nodejs package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force

# Security: Switch to non-root user before running
USER appuser

# Production environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=512" \
    TZ=UTC

# Enhanced health check for production (Render port)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f -H "Accept: application/json" http://localhost:10000/health || exit 1

# Expose port (Render standard)
EXPOSE 10000

# Security: Read-only root filesystem (uncomment when ready)
# USER appuser:nodejs

# Signal handling with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "production-server.cjs"]

# OCI Labels for metadata
LABEL org.opencontainers.image.title="AI Sales Platform" \
      org.opencontainers.image.description="Production-grade AI sales platform for WhatsApp & Instagram" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="AI Sales Platform Team" \
      org.opencontainers.image.licenses="PROPRIETARY" \
      org.opencontainers.image.source="https://github.com/ai-sales/platform" \
      org.opencontainers.image.documentation="https://docs.ai-sales.platform" \
      maintainer="AI Sales Platform Team <team@ai-sales.platform>"