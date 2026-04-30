# 🚴 CycloAgent

AI agent pre hľadanie rodinných cyklociest. Vyhľadáva asfaltové trasy vhodné pre e-bike rodinu s deťmi, zobrazuje ich na mape a pridáva predpoveď počasia.

## Architektúra

```
VPS / Docker
│
├── frontend  (nginx:alpine)    port 8080 → verejný prístup
│   ├── React + Vite (build)
│   └── nginx proxy /api → backend
│
└── backend   (node:20-alpine)  port 3001 → interný
    ├── Express.js
    ├── Rate limiting
    └── Proxy → Anthropic API
```

## Požiadavky

- Docker + Docker Compose v2
- Anthropic API kľúč → https://console.anthropic.com

---

## Inštalácia

### 1. Stiahni projekt

```bash
git clone <tvoj-repo> cyclo-agent
cd cyclo-agent
```

### 2. Nastav API kľúč

```bash
cp .env.example .env
nano .env
```

```env
ANTHROPIC_API_KEY=sk-ant-...

# Voliteľné: ochrana API tajným tokenom
# API_SECRET_TOKEN=zmen-toto
```

### 3. Spusti

**Produkcia:**
```bash
docker compose up -d --build
```
App beží na `http://tvoja-ip:8080`

**Development (hot reload):**
```bash
docker compose -f docker-compose.dev.yml up --build
```
- Frontend: `http://localhost:5173`
- Backend:  `http://localhost:3001`

---

## Správa

```bash
# Stav kontajnerov
docker compose ps

# Logy
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend

# Reštart
docker compose restart

# Aktualizácia (nový build)
docker compose up -d --build

# Zastavenie
docker compose down
```

---

## Štruktúra projektu

```
cyclo-agent/
├── docker-compose.yml          # produkcia
├── docker-compose.dev.yml      # vývoj
├── .env.example                # šablóna env premenných
├── .env                        # tvoj API kľúč (nie v gite!)
│
├── backend/
│   ├── server.js               # Express server + Anthropic proxy
│   ├── package.json
│   ├── Dockerfile              # produkcia
│   └── Dockerfile.dev          # vývoj
│
└── frontend/
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   └── components/
    │       └── CycloAgent.jsx  # hlavný komponent
    ├── index.html
    ├── vite.config.js
    ├── package.json
    ├── nginx.conf              # nginx konfigurácia + proxy
    ├── Dockerfile              # multi-stage build (produkcia)
    └── Dockerfile.dev          # vývoj s hot reload
```

---

## Pridanie HTTPS (odporúčané pre produkciu)

Ak máš na VPS nainštalovaný **nginx** alebo **Caddy** ako reverse proxy,
nastav ho aby smeroval na port 8080.

**Príklad Caddy konfigurácie:**
```
cycloagent.tvoja-domena.sk {
    reverse_proxy localhost:8080
}
```
Caddy vyrieši SSL certifikát automaticky cez Let's Encrypt.

---

## Rozširovanie PoC → Produkcia

| Funkcia                  | PoC stav        | Odporúčanie pre produkciu          |
|--------------------------|-----------------|-------------------------------------|
| Auth / login             | ❌ žiadny       | NextAuth, Clerk, alebo vlastný JWT  |
| Ukladanie výsledkov      | ❌ žiadne       | PostgreSQL / SQLite cez Prisma      |
| História vyhľadávaní     | ❌ žiadna       | Redis alebo DB                      |
| HTTPS                    | ❌ manuálne     | Caddy alebo Certbot                 |
| Monitoring               | ❌ žiadny       | Uptime Kuma, Grafana                |
| CI/CD                    | ❌ manuálne     | GitHub Actions → docker compose pull|
| CORS                     | ✅ otvorený     | Nastav `CORS_ORIGIN` v .env         |
| Rate limiting            | ✅ 20 req/min   | Zvýš/zníž podľa potreby             |
| Health check             | ✅ /health      | Napoj na monitoring                 |

---

## Riešenie problémov

**Backend nenaštartuje:**
```bash
docker compose logs backend
# Skontroluj: je ANTHROPIC_API_KEY nastavený v .env?
```

**Frontend zobrazuje chybu API:**
```bash
# Otestuj backend priamo
curl http://localhost:3001/health
```

**Mapa sa nezobrazuje:**
- Leaflet sa načítava z CDN — skontroluj internetové pripojenie kontajnera

**Agent trvá dlho / timeout:**
- Anthropic API môže trvať 20–40s pre komplexné vyhľadávanie
- Nginx timeout je nastavený na 90s — postačujúce
