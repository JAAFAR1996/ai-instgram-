FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Copy all source files
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

ENV NODE_ENV=production
EXPOSE 10000

# Run the compiled production file
CMD ["node", "dist/production-index.js"]