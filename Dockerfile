# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .

ARG VITE_API_SECRET_TOKEN
ENV VITE_API_SECRET_TOKEN=$VITE_API_SECRET_TOKEN

RUN npm run build

# ── Stage 2: Backend deps (kompilácia better-sqlite3) ─────────────────────────
FROM node:20-alpine AS backend-builder

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ── Stage 3: Finálny image ────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
COPY --from=backend-builder /app/node_modules ./node_modules
COPY backend/ .

# Frontend build do public/
COPY --from=frontend-builder /frontend/dist ./public

# Perzistentný adresár pre SQLite DB
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
