# Monorepo: build backend service from repo root
FROM node:20-alpine AS builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/backend/dist ./dist
COPY backend/drizzle ./drizzle

EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start"]
