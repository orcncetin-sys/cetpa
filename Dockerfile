# ─────────────────────────────────────────────────────────────────────────────
# Cetpa — Multi-stage Dockerfile
# Stage 1 (deps):    Production npm deps only
# Stage 2 (build):   Full install + Vite frontend build
# Stage 3 (runtime): Minimal image — prod deps + dist + server
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Production dependencies ─────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
# Build Vite frontend (outputs to dist/)
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S cetpa && adduser -S cetpa -G cetpa

# Production node_modules (includes tsx for TypeScript execution)
COPY --from=deps /app/node_modules ./node_modules

# Built frontend assets
COPY --from=build /app/dist ./dist

# Server source files
COPY server.ts startup.cjs tsconfig.json package.json ./

# Public assets (if any)
COPY public ./public

USER cetpa

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5173/api/health || exit 1

CMD ["node", "startup.cjs"]
