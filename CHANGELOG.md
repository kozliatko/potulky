# Changelog

Všetky podstatné zmeny sú zdokumentované v tomto súbore.
Formát vychádza z [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed
- **Produkčný Docker build bol rozbitý — `better-sqlite3@11.10.0` sa nedal skompilovať proti Node 26** — predošlý bump base image na `node:26-bookworm-slim` (Dockerfile) odhalil, že staršie `better-sqlite3` používa V8 API odstránené v novších V8 verziách (`v8::Object::GetPrototype`, `v8::Context::GetIsolate`, `PropertyCallbackInfo::This`) — `npm ci --omit=dev` v `backend-builder` stage zlyhával, takže akýkoľvek ďalší build produkčného image by padol. Bump na `better-sqlite3@13.0.3` (kompatibilné s aktuálnym V8) — overené kompletným `docker build` aj behom kontajnera (`/health` odpovedá)
- **CI bežal na Node 20, produkcia (Dockerfile) na Node 26** — `actions/setup-node` v `build.yml` zjednotený na Node 26 pre backend aj frontend job (spolu s bumpom `better-sqlite3` vyššie), nech CI reálne odráža produkčné prostredie a chytí podobné nezhody skôr
- **CI: krok „Coverage provider" mal natvrdo pripnutú verziu `@vitest/coverage-v8@^2.0.0`** — `@vitest/coverage-v8` musí presne sedieť s nainštalovaným `vitest`, takže akýkoľvek dependabot bump vitestu na major verziu (napr. 4.x) spôsobil `ERESOLVE` a pád CI ešte pred spustením testov. Verzia sa teraz zisťuje dynamicky z reálne nainštalovaného `vitest` (`node -p "require('vitest/package.json').version"`), takže tento krok už nikdy netreba ručne aktualizovať
- **PWA precache sťahoval `/history.js` (admin-only skript) každému bežnému návštevníkovi** — `globPatterns` v `vite.config.js` zbaľoval do precache manifestu úplne všetko, hoci `history.js` patrí len k chránenej `/history` stránke a bežná appka ho nikdy nepoužije. Pridané `globIgnores: ["history.js"]` — súbor sa naďalej normálne servuje pre `/history`, len ho service worker prestal zbytočne sťahovať a cachovať pre všetkých
- **Caddy `basic_auth` matcher `path /history*` chytal aj `/history.js`** — hviezdička znamená prefix-match, takže statický skript pre `/history` stránku (servovaný na `/history.js`) padal pod ochranu basic_auth spolu so samotnou stránkou. Keď si PWA service worker `/history.js` precachoval na pozadí, prehliadač dostal `401` a vyskočil natívny dialóg na meno/heslo — aj na hlavnej appke, ktorá s `/history` vôbec nesúvisí. Matcher zúžený na presnú zhodu `path /history` (backend má len jednu route, žiadne podcesty)
- **PWA update flow bol prakticky mŕtvy kód** — `registerType: "autoUpdate"` v `vite.config.js` núti vite-plugin-pwa natvrdo nastaviť `workbox.skipWaiting`/`clientsClaim` na `true` bez ohľadu na konfiguráciu; v tomto režime sa `onNeedRefresh` callback (zavedený v predchádzajúcej PWA oprave) **nikdy nezavolá** — knižnica namiesto neho tichým reloadom reaguje priamo na event `activated`, ktorý sa ale bez pravidelnej kontroly aktualizácie (žiadna v appke nebola) prirodzene nespustí pri SPA bez plnej navigácie. Výsledok: klienti vedeli ostať zaseknutí na starej verzii donekonečna (napr. rozbitá mapa po serverovej zmene API kontraktu)

### Added
- **Viditeľný PWA update banner** — `registerType: "prompt"` + odstránené `skipWaiting`/`clientsClaim`, takže nová verzia korektne čaká vo "waiting" stave a `onNeedRefresh` sa spoľahlivo spustí; namiesto tichého reloadu (ktorý mohol zmazať rozpísaný vstup) appka zobrazí banner "Obnoviť teraz" s poistkou automatického reloadu po 60 s, ak si ho nikto nevšimne
- Pravidelná kontrola aktualizácie (`registration.update()` každú hodinu + pri návrate appky z pozadia cez `visibilitychange`) — predtým sa kontrola spoliehala len na zriedkavé plné navigácie

---

## [2.1.0] — 2026-08-07

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
- `/history` — nová záložka **"Kvóty a náklady"**: globálny denný limit s progress barom, per-IP breakdown za dnešok (počet požiadaviek/limit, vyhľadávania, tokeny, odhadovaná útrata v $) — `db.js: requestsTodayByIpBreakdown()`
- Logovanie neplatných `/api/messages` požiadaviek (IP, mode, kľúče tela) — predtým úplne tiché 400 odpovede bez stopy v logoch

### Changed
- Zjednotené primárne zdroje dát medzi BikeAgent a HikeAgent — `PRIMARY_SOURCES` (`mapy.cz, komoot.com, openstreetmap`) zdieľané cez `formatSources()` helper, doménovo-špecifické zdroje (cycling.sk/bikemap.net/alltrails.com vs. hiking.sk/hiking.dennikn.sk/turistika.sk) ostávajú oddelené; odstránené krížové znečistenie (`hiking.sk` bolo predtým aj v BikeAgent zozname)

### Fixed
- Klikateľné zdroje — validácia URL cez `new URL()`, neplatné hodnoty zobrazené ako `<span>`
- Git história vyčistená od uniknutého `.env~` (obsahoval produkčné secrets)
- **XSS v `/history`** — polia `ip` a `status` sa vypisovali do HTML bez escapovania, `location` sa escapovalo len čiastočne (len `<`); teraz jedna `esc()` funkcia pre všetky interpolované polia
- Dockerfile: `node:20-alpine` → `node:20-bookworm-slim` (glibc) — Alpine musl chýba symbol `fcntl64`, `better-sqlite3` nešlo natívne nabootovať
- Dockerfile: explicitný `node-gyp` rebuild namiesto spoliehania na `prebuild-install` (sťahoval binárku s nesedícou Node ABI verziou)
- **PWA neaktualizovala už otvorenú záložku pri novom nasadení** — service worker sa na pozadí aktivoval (`skipWaiting`/`clientsClaim`), ale bežiaci JS v pamäti ostal starý; `registerSW()` teraz pri `onNeedRefresh` automaticky reloadne stránku
- **CSP regresia na `/history`** — `script-src 'self'` (bez `unsafe-inline`) ticho blokovala inline `<script>` aj `onclick`/`oninput`/`onchange` handlery, čím boli prepínanie záložiek aj filtre nefunkčné od zavedenia CSP; JS presunutý do `frontend/public/history.js` s `addEventListener` namiesto oslabenia CSP
- **Mapa (Leaflet) sa neprekresľovala pri prepnutí na iný výsledok z histórie** — `RouteMap` inicializovala mapu len raz (`useEffect` s prázdnym dependency array + guard), pri kliknutí na iný záznam z "Nedávne" v tej istej relácii zostala zaseknutá na pôvodnej lokalite; pridaný `key={location-centerLat-centerLng}` vynucuje remount pri zmene výsledku

### Security
- **Odstránený `API_SECRET_TOKEN`/`VITE_API_SECRET_TOKEN` úplne** — bol zapečený vo verejnom frontend bundli (viditeľný v DevTools), reálna ochrana teraz ide cez server-side limity a kvóty vyššie
- `/history` už nezdieľa token s frontend bundlom — nahradené samostatným bcrypt heslom cez Caddy
- CORS_ORIGIN zúžený na produkčnú doménu
- Generické chybové hlásenia klientovi (`err.message` už neuniká, len do serverových logov)

### Removed
- `caddy/Caddyfile` a `caddy/Dockerfile` — nahradené caddy-docker-proxy labelmi
- `certs/` adresár — certifikáty nepatria do repozitára
- Legacy `frontend/nginx.conf`, `frontend/Dockerfile(.dev)`, `backend/Dockerfile(.dev)`, `docker-compose.dev.yml` — pochádzali z prvého commitu, nikdy neboli aktualizované na súčasnú architektúru
- `@anthropic-ai/sdk` z `backend/package.json` — nepoužívaná závislosť z prvého commitu (éra Claude Haiku), projekt beží na DeepSeek V3 cez `openai` SDK už od v1.0.0

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
