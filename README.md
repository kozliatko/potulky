# BikeAgent

AI agent pre hľadanie rodinných cyklociest. Podľa zadanej lokality vyhľadá asfaltové trasy vhodné pre e-bike rodinu s deťmi (detský bicykel + cyklovozík), zobrazí ich na mape a pridá predpoveď počasia.

## Vetvy

| Vetva      | AI model                  | Vyhľadávanie          | API kľúče                          |
|------------|---------------------------|-----------------------|------------------------------------|
| `main`     | Claude Sonnet (Anthropic) | natívny web_search    | `ANTHROPIC_API_KEY`                |
| `deepseek` | DeepSeek V3               | Tavily Search API     | `DEEPSEEK_API_KEY`, `TAVILY_API_KEY` |

---

## Architektúra

### Prehľad

```
┌─────────────────────────────────────────────────────────┐
│  Docker kontajner  (node:20-alpine, port 8080)          │
│                                                         │
│  ┌─────────────────────┐   statické   ┌──────────────┐ │
│  │   Express.js        │◄────súbory───│  React/Vite  │ │
│  │   backend :3001     │              │  frontend    │ │
│  │                     │◄── POST /api/messages ──────┤ │
│  │  • rate limit       │              │              │ │
│  │  • auth token       │──odpoveď────►│              │ │
│  └────────┬────────────┘              └──────────────┘ │
└───────────┼─────────────────────────────────────────────┘
            │
     ┌──────┴──────────────────────────────────┐
     │  main vetva          deepseek vetva      │
     │                                          │
     │  Anthropic API       DeepSeek V3 API     │
     │  claude-sonnet       (OpenAI-compatible) │
     │  natívny             ↕ agentic loop      │
     │  web_search          Tavily Search API   │
     └──────────────────────────────────────────┘
```

**Development:**
```
docker-compose.dev.yml
├── frontend  (Vite dev server, hot reload)   port 5173
└── backend   (node --watch)                  port 3001
```

---

### Tok požiadavky

```
Používateľ zadá lokalitu
        │
        ▼
[BikeAgent.jsx] buildSystemPrompt(profile)
   → generuje system prompt podľa konfigurácie (e-bike / deti / vozík)
        │
        ▼
POST /api/messages  { system, messages, max_tokens }
        │
   ┌────┴──────────────────────────────────────────┐
   │ main vetva                deepseek vetva       │
   │                                                │
   │ Anthropic API             DeepSeek V3 API      │
   │ (jednoduchý proxy)        agentic loop:        │
   │                           1. DeepSeek → tool?  │
   │                           2. áno → Tavily      │
   │                           3. výsledok späť     │
   │                           4. opakuj (max 25x)  │
   └────────────────┬──────────────────────────────-┘
                    │
        { content: [{ type: "text", text }], usage }
                    │
                    ▼
[BikeAgent.jsx] extractFirstJSON(text)
   → nájde prvý kompletný JSON objekt (počítanie {})
   → jsonrepair() opraví malformácie
   → JSON.parse() → parsed result
                    │
                    ▼
        Render: taby, mapa, počasie
```

---

### Frontend — komponenty a stav

**Hlavný komponent `BikeAgent`** (`frontend/src/components/BikeAgent.jsx`)

| State         | Typ       | Popis                                      |
|---------------|-----------|--------------------------------------------|
| `location`    | string    | Zadaná lokalita                            |
| `phase`       | string    | `idle / searching / verifying / analyzing / done / error` |
| `result`      | object    | Parsovaný JSON z AI                        |
| `profile`     | object    | `{ hasEbike, hasChildren, hasTrailer }`    |
| `usage`       | object    | `{ inputTokens, outputTokens, searchCount }` |
| `filters`     | object    | `{ difficulty[], minScore, trailerOnly }`  |
| `activeTab`   | number    | Index aktívnej trasy                       |
| `history`     | array     | Posledných 10 vyhľadávaní (localStorage)   |

**Kľúčové funkcie:**

| Funkcia              | Popis                                                  |
|----------------------|--------------------------------------------------------|
| `buildSystemPrompt`  | Generuje system prompt dynamicky podľa profilu         |
| `extractFirstJSON`   | Extrahuje JSON zo surového textu (počítanie zanorenia) |
| `calcCost`           | Orientačná cena v USD z počtu tokenov a vyhľadávaní   |
| `runAgent`           | Zavolá backend, spracuje odpoveď, uloží do histórie    |
| `filteredRoutes`     | Computed pole trás po aplikovaní filtrov               |

**Subkomponenty:**

| Komponent        | Popis                                                         |
|------------------|---------------------------------------------------------------|
| `RouteMap`       | Leaflet mapa — číslované piny trás + zlatý marker lokality    |
| `WeatherForecast`| 3-dňová predpoveď z open-meteo.com pre každú trasu           |

---

### PWA

Aplikácia spĺňa požiadavky Progressive Web App — dá sa nainštalovať na domovskú obrazovku telefónu alebo desktopu.

| Súčasť | Popis |
|--------|-------|
| `vite-plugin-pwa` | Plugin generuje service worker (Workbox) a `manifest.webmanifest` počas buildu |
| `manifest.webmanifest` | Názov, ikona, téma (#059669), `display: standalone`, jazyk SK |
| `sw.js` + `workbox-*.js` | Service worker s precache statických assets a runtime cache stratégiami |
| Ikony | 64 / 192 / 512 px PNG + maskable 512 px + Apple Touch 180 px + favicon.ico |

**Cache stratégie (Workbox):**

| URL vzor | Stratégia | Detail |
|----------|-----------|--------|
| `/api/*` | NetworkOnly | Vyhľadávanie AI vždy cez sieť |
| `api.open-meteo.com` | NetworkFirst | Počasie, cache 1 hod, max 20 záznamov |
| `*.tile.openstreetmap.org` | CacheFirst | Mapové dlaždice, cache 7 dní, max 500 |
| Statické assets | Precache | JS, CSS, HTML, PNG, SVG, ICO, WOFF2 |

**Inštalácia na iOS:** Safari → Zdieľať → Pridať na domovskú obrazovku  
**Inštalácia na Android/Desktop:** Chrome → adresný riadok → ikona inštalácie

---

### Backend — middleware a routes

**`backend/server.js`**

```
POST /api/messages
  └── authMiddleware        (x-api-token hlavička, ak API_SECRET_TOKEN nastavený)
  └── rateLimiter           (20 req/min na IP)
  └── runAgent()
        ├── main:     Anthropic SDK → claude-sonnet-4-20250514
        └── deepseek: agentic loop → DeepSeek V3 + Tavily Search (max 25 iterácií)
  └── { content: [{ type: "text", text }], usage }

GET /health               → { status: "ok", timestamp }
GET *                     → index.html  (SPA fallback)
```

Response formát je identický pre obe vetvy — frontend nepotrebuje vedieť, ktorý backend beží.

---

### Externé závislosti

| Služba                  | Využitie                                 | Vetva       |
|-------------------------|------------------------------------------|-------------|
| Anthropic API           | LLM + natívny web_search nástroj         | main        |
| DeepSeek API            | LLM (OpenAI-compatible endpoint)         | deepseek    |
| Tavily Search API       | Webové vyhľadávanie pre agentic loop     | deepseek    |
| OpenStreetMap tiles CDN | Mapové dlaždice v Leaflet                | obe         |
| Open-Meteo API          | Predpoveď počasia (bezplatné, bez kľúča) | obe         |
| Mapy.cz                 | Externý navigačný odkaz na cyklotrasu    | obe         |
| Leaflet CDN             | Knižnica interaktívnej mapy              | obe         |

---

## Požiadavky

- Docker + Docker Compose v2
- API kľúče podľa aktívnej vetvy (pozri tabuľku vyššie)

---

## Inštalácia

### 1. Nastav env premenné

```bash
cp .env.example .env
nano .env
```

**`main` vetva:**
```env
ANTHROPIC_API_KEY=sk-ant-...

# Voliteľné
API_SECRET_TOKEN=vlastny-tajny-token
VITE_API_SECRET_TOKEN=vlastny-tajny-token
```

**`deepseek` vetva:**
```env
DEEPSEEK_API_KEY=sk-...
TAVILY_API_KEY=tvly-...

# Voliteľné
API_SECRET_TOKEN=vlastny-tajny-token
VITE_API_SECRET_TOKEN=vlastny-tajny-token
```

### 2. Spusti

**Produkcia:**
```bash
docker compose up -d --build
```
App beží na `http://localhost:8080`

**Development (hot reload):**
```bash
docker compose -f docker-compose.dev.yml up --build
```
- Frontend: `http://localhost:5173`
- Backend:  `http://localhost:3001`

---

## Testovanie

### Unit testy (backend)

```bash
cd backend && npm test
```

Testujú Express routes, validáciu vstupu a auth middleware s mocknutým AI klientom (Vitest + Supertest).

### Smoke testy — overenie živej aplikácie

Idú proti bežiacim Docker kontajnerom, nevyžadujú lokálny Node.js:

```bash
docker run --rm \
  --network cyclo-agent_internal \
  -e BASE_URL=http://cyclo-agent:3001 \
  -v $(pwd)/tests:/tests \
  node:22-alpine node --test /tests/smoke.test.js
```

Čo overujú:

| Skupina | Testy |
|---|---|
| Health | `GET /health` → 200, `status:ok`, timestamp |
| Frontend | `/` vracia HTML, favicon, PWA ikona, SPA fallback |
| API validácia | Chybné requesty → 400/401 s `error` poľom |
| API auth | Nesprávny token → 401 |
| API routing | Neznámy endpoint → 404 |
| Bezpečnostné hlavičky | `X-Content-Type-Options`, server header skrytý |

### Spustiť všetky testy

```bash
npm run test:all
```

---

## Správa

```bash
# Stav
docker compose ps

# Logy
docker compose logs -f
docker compose logs -f app

# Reštart bez rebuildu
docker compose restart

# Rebuild + reštart (po zmene kódu)
docker compose build && docker compose up -d

# Zastavenie
docker compose down
```

---

## Štruktúra projektu

```
bikeagent/
├── docker-compose.yml          # produkcia (jednokontajnerová)
├── docker-compose.dev.yml      # vývoj (frontend + backend separátne)
├── Dockerfile                  # multi-stage build: React → Node server
├── .env.example                # šablóna env premenných
├── .env                        # tvoje API kľúče (nie v gite!)
├── package.json                # skripty na spustenie testov
│
├── tests/
│   └── smoke.test.js           # smoke testy — overenie že app beží
│
├── backend/
│   ├── server.js               # Express server
│   │                           #   main:     Anthropic proxy
│   │                           #   deepseek: agentic loop (DeepSeek + Tavily)
│   ├── server.test.js
│   ├── package.json
│   ├── Dockerfile              # produkcia
│   └── Dockerfile.dev          # vývoj (node --watch)
│
└── frontend/
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── utils.js            # weatherInfo (open-meteo.com)
    │   └── components/
    │       ├── BikeAgent.jsx   # hlavný komponent + SYSTEM_PROMPT
    │       └── BikeAgent.test.jsx
    ├── index.html
    ├── vite.config.js
    ├── nginx.conf              # /api proxy → backend:3001
    ├── package.json
    ├── Dockerfile              # multi-stage: build → nginx:alpine
    └── Dockerfile.dev          # Vite dev server s hot reload
```

---

## AI agent — ako funguje

### `main` vetva (Anthropic)

Backend je jednoduchý proxy — prepošle požiadavku na Anthropic API s natívnym `web_search_20250305` nástrojom. Claude sám riadi vyhľadávanie.

### `deepseek` vetva (DeepSeek + Tavily)

Backend implementuje agentic loop:

1. Pošle správu DeepSeek V3 s definíciou `web_search` nástroja
2. Ak DeepSeek zavolá nástroj → backend vykoná Tavily Search
3. Výsledok vloží do histórie, zavolá DeepSeek znova
4. Opakuje max. 25 iterácií, kým DeepSeek nevráti finálny text

Response formát je identický s Anthropic API (`{ content: [{ type: "text", text }] }`), takže frontend funguje bez zmien.

### System prompt

Generovaný dynamicky funkciou `buildSystemPrompt(profile)` v `frontend/src/components/BikeAgent.jsx`. Obsah sa mení podľa konfigurácie profilu (e-bike, deti, prívesný vozík) — iné požiadavky na dĺžku, povrch a bezpečnosť trasy.

Agent dostane pokyn vrátiť výsledky ako čistý JSON s touto schémou:

```json
{
  "summary": "string",
  "centerLat": 48.736,
  "centerLng": 19.146,
  "routes": [
    {
      "name": "string",
      "distance": "X km",
      "surface": "Asfalt | Spevnená cesta | Zmiešaný",
      "difficulty": "Ľahká | Stredná | Ťažká",
      "elevation": "X m prevýšenia",
      "highlights": "string",
      "trailerFriendly": "Áno | Čiastočne | Nie — dôvod",
      "childFriendlyScore": 8,
      "startLat": 48.736,
      "startLng": 19.146,
      "sources": ["url1", "url2"],
      "warnings": "string | null",
      "recommendation": "string",
      "pointsOfInterest": [
        {
          "name": "string",
          "type": "hrad | ihrisko | kúpalisko | reštaurácia | príroda | múzeum | rozhľadňa",
          "distance": "X km od trasy",
          "description": "string"
        }
      ]
    }
  ],
  "generalTips": "string"
}
```

Frontend extrahuje JSON pomocou `extractFirstJSON()` (počítanie zanorenia `{}`), ktorá správne ignoruje akýkoľvek text za JSON blokom — odolné voči komentárom a vysvetlivkám, ktoré AI pridá za odpoveď. Následne opravuje bežné chyby cez `jsonrepair` (chýbajúce úvodzovky pri hodnotách s diakritikou, trailing čiarky a pod.). Pri zlyhaní sa raw odpoveď AI loguje do konzoly prehliadača.

---

## Riešenie problémov

**`402 Insufficient Balance` (deepseek vetva)**
→ Nabiť kredit na [platform.deepseek.com](https://platform.deepseek.com)

**`Agent prekročil maximálny počet krokov`**
→ DeepSeek volá príliš veľa vyhľadávaní. Skontroluj SYSTEM_PROMPT — limit je nastavený na max 10 `web_search` volaní.

**`Chyba spracovania JSON` alebo `Agent nevrátil správny formát odpovede`**
→ AI vrátila odpoveď v neočakávanom formáte. Otvor DevTools → Console — raw odpoveď AI je zalogovaná ako `[BikeAgent] Raw AI response`. Skopíruj ju pre diagnostiku.

**Backend nenaštartuje:**
```bash
docker compose logs app
# Skontroluj: sú API kľúče nastavené v .env?
```

**Mapa sa nezobrazuje:**
→ Leaflet sa načítava z CDN — skontroluj internetové pripojenie.

**Pin trasy chýba na mape:**
→ AI nevrátila GPS súradnice pre danú trasu. Trasa sa zobrazí orientačným pinom (~číslo, prerušovaný okraj) na centre oblasti.

**Agent trvá dlho (30–60s):**
→ Normálne správanie pri viacerých web search volaniach. Nginx timeout je 90s.

---

## Changelog

### v1.1.0
- Responzívny dizajn — svetlá farebná téma, taby sa zalamujú namiesto horizontálneho scrollu
- Mapa — zlatý 📍 marker pre centrum vyhľadávanej lokality
- Mapa — fallback orientačný pin (~číslo) pre trasy bez GPS súradníc
- JSON parsing — `extractFirstJSON()` namiesto greedy regex, odolné voči textu za JSON blokom
- Debugovanie — raw AI odpoveď sa loguje do konzoly pri zlyhaní parsingu

### v1.0.0
- Základná verzia: vyhľadávanie trás, Leaflet mapa, predpoveď počasia
- Konfigurovateľný profil skupiny (e-bike, deti, prívesný vozík)
- História vyhľadávaní (localStorage), filtrovanie trás, meranie nákladov
- Zobrazenie trás ako taby
- Navigačný odkaz na Mapy.cz

---

## HTTPS (produkcia)

Caddy beží ako samostatný kontajner, terminuje TLS a automaticky získava certifikát od Let's Encrypt.

### Štruktúra

```
Internet
  :80  ──► cyclo-caddy ──► HTTP → HTTPS redirect (automatický)
  :443 ──► cyclo-caddy ──► reverse_proxy app:3001 (interná sieť)
                │
                └── Let's Encrypt ACME (certifikát uložený vo volume caddy_data)
```

### Požiadavky

- Doména `bike.kozliatko.sk` musí smerovať DNS A záznam na IP servera
- Porty 80 a 443 musia byť dostupné z internetu (ACME HTTP-01 challenge)

### Konfigurácia

V `.env` nastav e-mail pre notifikácie o expirácii certifikátu:

```env
CADDY_ACME_EMAIL=tvoj@email.sk
```

### Spustenie

```bash
# Prvé spustenie — Caddy automaticky získa certifikát
docker compose up -d --build

# Logy Caddy (vrátane ACME komunikácie)
docker compose logs -f caddy

# Access logy (JSON formát, rotácia 10 MB × 5)
docker compose exec caddy tail -f /var/log/caddy/access.log
```

### Čo Caddy robí

| Funkcia | Detail |
|---------|--------|
| TLS certifikát | Automaticky cez Let's Encrypt (ACME), uložený vo volume `caddy_data` |
| Obnova certifikátu | Automatická — Caddy obnoví pred expiráciou bez reštartu |
| HTTP → HTTPS | Automatický redirect, nie je potrebný explicitný `:80` blok |
| Reverse proxy | Prepošle na `app:3001`, timeout 120 s (AI vyhľadávania) |
| Kompresia | gzip pre HTML/JS/CSS/JSON |
| Security hlavičky | HSTS (1 rok), X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| Access log | JSON, `/var/log/caddy/access.log`, rotácia 10 MB, 5 súborov |

### Debug — priamy prístup bez Caddy

V `docker-compose.yml` odkomentuj `ports` pri `app` service:

```yaml
app:
  ports:
    - "8080:3001"
```

### Konfiguračné súbory

| Súbor | Popis |
|-------|-------|
| `caddy/Caddyfile` | Caddy konfigurácia — doménový blok `bike.kozliatko.sk` |
| `caddy/Dockerfile` | `FROM caddy:2-alpine` + `COPY Caddyfile` |
