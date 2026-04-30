# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .

ARG VITE_API_SECRET_TOKEN
ENV VITE_API_SECRET_TOKEN=$VITE_API_SECRET_TOKEN

RUN npm run build

# ── Stage 2: Node.js server + frontend bundle ─────────────────────────────────
FROM node:20-alpine

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .

# Frontend build do public/
COPY --from=frontend-builder /frontend/dist ./public

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
