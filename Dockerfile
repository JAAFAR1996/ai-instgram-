# ===============================================
# Build Stage - Compile TypeScript and Install Dependencies
# ===============================================
FROM node:20-alpine AS builder

# Install necessary build tools
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files first for better cache layering
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev

# Copy TypeScript configuration files (required for build)
COPY tsconfig*.json ./

# Copy source code
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# ===============================================
# Runtime Stage - Production Runtime Environment
# ===============================================
FROM node:20-alpine AS runtime

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Install runtime security updates
RUN apk add --no-cache dumb-init && \
    apk upgrade

# Copy built application and production dependencies from builder
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

# Use non-root user
USER nextjs

# Expose port
EXPOSE 10000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the compiled production file
CMD ["node", "dist/production-index.js"]