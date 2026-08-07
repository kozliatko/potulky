# Changelog

Všetky podstatné zmeny sú zdokumentované v tomto súbore.
Formát vychádza z [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- Globálny rate limiter (120 req/min) pred API-špecifickým (20 req/min)
- URIError error handler — loguje IP a cestu pri pokusoch o path traversal
- Caddy access log cez Docker labels (`caddy.log`, `caddy.log.output`, `caddy.log.format`)
- Fail2ban na hoste — ochrana všetkých webov cez Caddy JSON logy
- `/history` chránený Caddy `basic_auth` (path-scoped na `/history*`) namiesto zdieľaného `x-api-token`
- **Server-side prompt building** (`backend/prompts.js`) — server si sám skladá system prompt aj user message z `mode`/`profile`/`location`; klient už neposiela `system`/`messages`/`max_tokens` (predtým otvorené zneužitie ako free-for-all DeepSeek/Tavily proxy)
- **Denné kvóty** — `MAX_REQUESTS_PER_IP_PER_DAY` (429), `MAX_GLOBAL_REQUESTS_PER_DAY` (503), obe konfigurovateľné cez env
- **Retencia dát** — `pruneOldRecords()` maže záznamy staršie ako `HISTORY_RETENTION_DAYS` (default 90 dní), pri štarte a každých 24h
- CSP + `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` cez Caddy `caddy.header.*` labely
- `.github/workflows/build.yml` — CI job spúšťajúci backend testy (vitest) a frontend build pri každom pushi/PR
- `.dockerignore` — chýbal úplne, `COPY backend/ .` inak kopírovalo aj lokálny `node_modules/`

### Fixed
- Klikateľné zdroje — validácia URL cez `new URL()`, neplatné hodnoty zobrazené ako `<span>`
- Git história vyčistená od uniknutého `.env~` (obsahoval produkčné secrets)
- **XSS v `/history`** — polia `ip` a `status` sa vypisovali do HTML bez escapovania, `location` sa escapovalo len čiastočne (len `<`); teraz jedna `esc()` funkcia pre všetky interpolované polia
- Dockerfile: `node:20-alpine` → `node:20-bookworm-slim` (glibc) — Alpine musl chýba symbol `fcntl64`, `better-sqlite3` nešlo natívne nabootovať
- Dockerfile: explicitný `node-gyp` rebuild namiesto spoliehania na `prebuild-install` (sťahoval binárku s nesedícou Node ABI verziou)

### Security
- **Odstránený `API_SECRET_TOKEN`/`VITE_API_SECRET_TOKEN` úplne** — bol zapečený vo verejnom frontend bundli (viditeľný v DevTools), reálna ochrana teraz ide cez server-side limity a kvóty vyššie
- `/history` už nezdieľa token s frontend bundlom — nahradené samostatným bcrypt heslom cez Caddy
- CORS_ORIGIN zúžený na produkčnú doménu
- Generické chybové hlásenia klientovi (`err.message` už neuniká, len do serverových logov)

### Removed
- `caddy/Caddyfile` a `caddy/Dockerfile` — nahradené caddy-docker-proxy labelmi
- `certs/` adresár — certifikáty nepatria do repozitára
- Legacy `frontend/nginx.conf`, `frontend/Dockerfile(.dev)`, `backend/Dockerfile(.dev)`, `docker-compose.dev.yml` — pochádzali z prvého commitu, nikdy neboli aktualizované na súčasnú architektúru

---

## [2.0.0] — 2026-07

### Added
- Nový mód: **HikeAgent** — turistika s podporou kočíka, detí a seniorov
- GPS tlačidlo 📍 s Nominatim reverse geocodingom (OpenStreetMap, `accept-language=sk`)
- SQLite logovanie vyhľadávaní — IP, lokalita, tokeny, trvanie, status (`db.js`)
- `/history` endpoint s HTML tabuľkou a filtráciou (chránený `x-api-token`)
- Auth middleware (`x-api-token` hlavička, voliteľný cez `API_SECRET_TOKEN`)
- Limit Tavily vyhľadávaní vynútený v kóde (max 10 volaní na request)
- Klikateľné zdroje vo výstupe trasy
- Zdroje pre BikeAgent rozšírené o `cycling.sk`, `bikemap.net`, `alltrails.com`, `komoot.com`
- Caddy timeout predĺžený: 120 s → 300 s (pre zahraničné lokality)

### Changed
- Projekt premenovaný: **BikeAgent → Potulky**
- Deployment: lokálny Caddy kontajner → **caddy-docker-proxy** (labely)
- Tavily výsledky skrátené na 800 znakov (prevencia timeoutov)

---

## [1.1.0] — 2026-05

### Added
- Responzívny dizajn
- `extractFirstJSON()` — odolné voči textu za JSON blokom
- Debugovanie raw AI odpovede v konzole
- Zlatý marker na mape

---

## [1.0.0] — 2026-04

### Added
- Základná verzia: vyhľadávanie cyklotrás, Leaflet mapa, predpoveď počasia
- Profil skupiny (e-bike, deti, prívesný vozík)
- Filtrovanie trás, história vyhľadávaní, meranie nákladov
- Odkaz na otvorenie trasy v Mapy.cz (cyklo mapa)
- DeepSeek V3 + Tavily Search namiesto Anthropic Claude
- PWA podpora (service worker, manifest, ikony)
