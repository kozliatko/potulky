# BikeAgent

AI agent pre hľadanie rodinných cyklociest. Podľa zadanej lokality vyhľadá asfaltové trasy vhodné pre e-bike rodinu s deťmi (detský bicykel + cyklovozík), zobrazí ich na mape a pridá predpoveď počasia.

## Vetvy

| Vetva      | AI model                  | Vyhľadávanie          | API kľúče                          |
|------------|---------------------------|-----------------------|------------------------------------|
| `main`     | Claude Sonnet (Anthropic) | natívny web_search    | `ANTHROPIC_API_KEY`                |
| `deepseek` | DeepSeek V3               | Tavily Search API     | `DEEPSEEK_API_KEY`, `TAVILY_API_KEY` |

---

## Architektúra

```
Docker (produkcia)
│
└── app (node:20-alpine)   port 8080
    ├── Express.js backend  (port 3001 interný)
    │   ├── Rate limiting (20 req/min)
    │   ├── Voliteľná autorizácia (x-api-token)
    │   ├── main:     Anthropic proxy → claude-sonnet-4-20250514
    │   └── deepseek: Agentic loop → DeepSeek V3 + Tavily Search
    └── React frontend (Vite build, servovaný ako statické súbory)
        ├── Leaflet mapa s trasami
        ├── Predpoveď počasia (open-meteo.com)
        └── jsonrepair — oprava malformovaného JSON z AI
```

**Development:**
```
docker-compose.dev.yml
├── frontend  (Vite dev server, hot reload)   port 5173
└── backend   (node --watch)                  port 3001
```

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

Definovaný v `frontend/src/components/BikeAgent.jsx` — konštanta `SYSTEM_PROMPT` (riadok ~10).

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

Frontend parsuje JSON cez `jsonrepair` — opravuje bežné chyby AI (chýbajúce úvodzovky pri hodnotách s diakritikou, trailing čiarky a pod.).

---

## Riešenie problémov

**`402 Insufficient Balance` (deepseek vetva)**
→ Nabiť kredit na [platform.deepseek.com](https://platform.deepseek.com)

**`Agent prekročil maximálny počet krokov`**
→ DeepSeek volá príliš veľa vyhľadávaní. Skontroluj SYSTEM_PROMPT — limit je nastavený na max 10 `web_search` volaní.

**`Unexpected token ... is not valid JSON`**
→ jsonrepair je aktívny a mal by to opraviť automaticky. Ak nie, skontroluj konzolu prehliadača pre pôvodnú AI odpoveď.

**Backend nenaštartuje:**
```bash
docker compose logs app
# Skontroluj: sú API kľúče nastavené v .env?
```

**Mapa sa nezobrazuje:**
→ Leaflet sa načítava z CDN — skontroluj internetové pripojenie.

**Agent trvá dlho (30–60s):**
→ Normálne správanie pri viacerých web search volaniach. Nginx timeout je 90s.

---

## HTTPS (produkcia)

Odporúčame Caddy ako reverse proxy pred Docker kontajnerom:

```
bikeagent.tvoja-domena.sk {
    reverse_proxy localhost:8080
}
```

Caddy vyrieši SSL certifikát automaticky cez Let's Encrypt.
