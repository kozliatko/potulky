# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_API_SECRET_TOKEN
ENV VITE_API_SECRET_TOKEN=$VITE_API_SECRET_TOKEN

RUN npm run build

# ── Stage 2: Serve ────────────────────────────────────────────────────────────
FROM nginx:alpine

# Nginx konfigurácia (proxy na backend)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Skopíruj build
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
