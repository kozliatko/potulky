# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:26-bookworm-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .

RUN npm run build

# ── Stage 2: Backend deps (kompilácia better-sqlite3) ─────────────────────────
FROM node:26-bookworm-slim AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
# Balík so sebou nesie predkompilovanú binárku nesediacu na ABI verziu bežiaceho
# Node a "npm rebuild" ju cez prebuild-install znova stiahne (rovnaký problém).
# Zavoláme node-gyp priamo (npm-om už dodaný, žiadne sťahovanie navyše),
# čím prebuild-install úplne obídeme.
RUN rm -rf node_modules/better-sqlite3/build \
    && cd node_modules/better-sqlite3 \
    && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release

# ── Stage 3: Finálny image ────────────────────────────────────────────────────
FROM node:26-bookworm-slim

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
  CMD node -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
