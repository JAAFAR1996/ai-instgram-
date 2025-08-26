FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
USER node
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/database/migrations ./src/database/migrations
COPY legal ./legal
EXPOSE 10000
CMD ["node", "--enable-source-maps", "dist/production-index.js"]