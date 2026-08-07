# Bezpečnostná analýza projektu „potulky"

**Pôvodný dátum:** 2026-08-07 · **Aktualizované:** 2026-08-07 (po pull `main`, commit `c2cf05c`)
**Predpoklad:** projekt je verejná služba (**public**, bez prihlasovania používateľov).
**Rozsah:** backend (Express/Node), frontend (React/Vite), infraštruktúra (Docker, Caddy), CI/CD.

> Skratky: **K** = kritické · **V** = vysoké · **S** = stredné · **N** = nízke.
> Stav nálezu: ✅ **vyriešené** · 🟡 **čiastočne** · ⚠️ **otvorené/odporúča sa riešiť**

---

## 0. Stav po aktualizácii kódu (Executive summary)

Projekt prešiel zásadnou aktualizáciou, ktorá implementovala **väčšinu odporúčaní** z tejto analýzy.
Zhrnutie stavu klúčových nálezov:

| # | Nález | Závažnosť | Stav |
|---|-------|-----------|------|
| 1.1 | Klient kontroluje systém prompt + max_tokens | K | ✅ Vyriešené (`backend/prompts.js`, fixný `MAX_TOKENS`) |
| 1.2 | Falošná autentifikácia cez verejný token | K | ✅ Vyriešené (token úplne odstránený) |
| 1.3 | Slabý rate limiting / bez cenového rozpočtu | V | ✅ Vyriešené (denná kvóta na IP + globálny denný strop) |
| 1.4 | XSS v `/history` – nedostatočné escapovanie | V | ✅ Vyriešené (kompletná `esc()` na všetkých poliach) |
| 1.5 | `trust proxy` + expozícia portu 3001 | V | 🟡 Čiastočne (port už nie je exponovaný; `trust proxy` zostáva) |
| 1.6 | `/history` bez auth v aplikácii | V | 🟡 Čiastočne (ochrana cez Caddy; bez vlastnej auth v aplikácii) |
| 2.1 | Chýbajúca CSP | S | ✅ Vyriešené (plná CSP v Caddy labels) |
| 2.2 | Únik interných chýb (500) | S | ✅ Vyriešené (generická chyba) |
| 2.3 | Súkromie IP / retention | S | 🟡 Čiastočne (retention je; anonymizácia IP nie) |
| 2.4 | CORS `*` | S | ⚠️ Otvorené (`origin: *` default zostáva) |
| 2.5 | Hardening Docker / pinning | S | ✅ Vyriešené (`npm ci`, pinnovaný Node, non-root, HEALTHCHECK) |
| 2.6 | CI bez build/test | S | ✅ Vyriešené (pridaný `build.yml`) |
| 2.7 | Rate limit na statiku/health | S | 🟡 Čiastočne (globálny limiter stále pokrýva `/`) |

*Zostávajúce nižšie riziká: anonymizácia IP, CORS `*`, spresnenie `trust proxy`, drobné v 3.*

---

## 1. Kritické / Vysoké

### 1.1 [K] Klient kontroloval systém prompt a max_tokens → prompt injection a zneužitie nákladov — ✅ **vyriešené**

**Pôvodná situácia:** `POST /api/messages` bral `{ system, messages, max_tokens }` priamo z tela.
Verejný útočník mohol obísť prompt, nechať agenta robiť ľubovoľné Tavily vyhľadávania a nastaviť
obrovské `max_tokens` (ekonomická zneužitie platenej API).

**Aktuálny stav (`backend/server.js`, `backend/prompts.js`):**
- Token `system` od klienta sa **ignoruje**. Server si prompt zostaví sám vo funkcii
  `buildPrompt(mode, profile, rawLocation)` (nový modul `backend/prompts.js`, ~206 riadkov).
- `max_tokens` je **fixný konštantou** `MAX_TOKENS = 8000` (riadok 13) a ID sa nedá z tela.
- Z tela sa preberá len poloha/mód a `messages` (validované, pole).
- Klientské dáta sa vkladajú do promptu ako `userMessage`, nie ako kontrolný systémový prompt →
  prompt injection priestor sa drasticky zmenšil.
- Pribudol unit test (`backend/server.test.js`), ktorý overuje, že server **ignoruje** `system`
  aj `max_tokens: 999999` od klienta a použije `max_tokens = 8000`.

**Pokračovanie (voliteľné):** sprísniť `messages` – rezať dĺžku každej správy a počet správ,
prípadne ešte znížiť stropy agenta (limit 10 vyhľadávaní, 25 krokov je stále štedrých).

### 1.2 [K] Falošná autentifikácia cez verejný token — ✅ **vyriešené**

**Pôvodná situácia:** Backend v produkcii vynucoval `API_SECRET_TOKEN`, ktorý bol zapálený do
verejného bundlu cez `VITE_API_SECRET_TOKEN`. „Auth" bol bezcenný a v rozpore so zámerom public.

**Aktuálny stav:** Overené `grep` – `API_SECRET_TOKEN`, `VITE_API_SECRET_TOKEN`, `x-api-token`,
`authMiddleware` ani produkčný `throw` **už v kóde nie sú**. Frontend (Bike/HikeAgent), Dockerfile,
compose ani `.env.example` token neobsahujú. Ochrana verejnej služby je teraz postavená na
serverových promptoch, denných kvótach a globálnom budgete (body 1.3) + edge (Caddy).

### 1.3 [V] Slabý rate limiting / neexistujúci cenový rozpočet — ✅ **vyriešené**

**Pôvodná situácia:** Len per-minútové limity (`apiLimiter` 20/min, globálny 120/min), obídateľné
IP spoofingom; žiadny denný limit ani globálny strop nákladov.

**Aktuálny stav (`backend/server.js` r. 13–15, `backend/db.js`):**
- **Denná kvóta na IP:** `MAX_REQUESTS_PER_IP_PER_DAY` (default 15) →
  `if (requestsTodayByIp(ip) >= ...) return res.status(429)...` (r. 168).
- **Globálny denný strop:** `MAX_GLOBAL_REQUESTS_PER_DAY` (default 300) → 429 (r. 165).
- Počítadlá sa vedú **v SQLite** (`requestsTodayByIp`, `requestsToday`), prežijú reštart (na rozdiel
  od in-memory cache).
- Per-minútové limitery (`limiter` 120, `apiLimiter`) ostali.
- Konfigurovateľné cez env vars `.env`.

**Pokračovanie (voliteľné):** zvážiť aj tokenový budget (celkový denný počet vstupných/výstupných
tokenov), nielen počet HTTP requestov.

### 1.4 [V] XSS v `/history` (nedostatočné escapovanie) — ✅ **vyriešené**

**Pôvodná situácia:** `r.location.replace(/</g, "&lt;")` escapoval len `<`; ostatné polia (IP,
status, user_agent) sa vypisovali priamo.

**Aktuálny stav (`backend/server.js`):**
```js
const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]);
```
`esc()` sa používa na **všetky** používateľom ovplyvniteľné polia v šablóne `/history` (`ip`,
`location`, `status`). Kompletné escapovanie 5 znakov.

### 1.5 [V] `trust proxy` + expozícia backend portu — 🟡 **čiastočne vyriešené**

**Pôvodná situácia:** `docker-compose.dev.yml` mapoval porty `3001:3001` a `5173:5173` → útočník
mohol na backend posielať vlastný `X-Forwarded-For` a obísť limity / zapísať falošnú IP.

**Aktuálny stav:**
- ✅ `docker-compose.dev.yml` **odstránený**; produkčný compose zverejňuje len 3001 na **internú
  sieť caddy** (žiadne mapovanie host portov). Port 3001 už nie je exponovaný na internet.
- 🟡 `app.set("trust proxy", 1)` (r. 17) **zostáva**. Pri nexponovanom porte je riziko výrazne
  nižšie, ale odporúča sa čistejšia definícia proxy hops (napr. `"loopback, linklocal, uniquelocal"`),
  aby sa IP determinovala jednoznačne za Caddy.

### 1.6 [V] `/history` bez vlastnej autentifikácie v aplikácii — 🟡 **čiastočne vyriešené**

**Pôvodná situácia:** `/history` nemal authMiddleware; ochrana bola len Caddy basic_auth (path
`history*`). Pri priamom prístupe na backend port by unikali IP adresy.

**Aktuálny stav:**
- ✅ Port 3001 už nie je verejne exponovaný (bod 1.5) → priamy neautorizovaný prístup je stiahnutý.
- ✅ `/history` ostáva za Caddy basic_auth (`caddy.basic_auth: "@history_path"`).
- 🟡 V aplikácii stále nie je vlastná autorizácia: ak by sa obraz znovu exponoval na host port,
  `/history` by bolo otvorené. Odporúča sa **defense-in-depth** – voliteľná aplikovaná auth
  (napr. env `ADMIN_TOKEN`, timing-safe) popri Caddy.

---

## 2. Stredné

### 2.1 [S] Chýbajúca Content-Security-Policy (CSP) — ✅ **vyriešené**

**Aktuálny stav:** Plná CSP pridaná v `docker-compose.yml` do Caddy headerov:
`default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://api.open-meteo.com https://nominatim.openstreetmap.org; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` — spolu s `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS. ⚠️ Pozn.: CSP v docker labels píše hodnotu s vnútornými úvodzovkami – treba overiť, že Caddy ju aplikuje bez zduplikovania úvodzoviek (kľúč `caddy.header.Content-Security-Policy` odvodený z label).

### 2.2 [S] Únik interných chýb — ✅ **vyriešené**
`res.status(500).json({ error: "Interná chyba servera." })` — generická odpoveď; detaily na server.
Ešte zostáva `result = \`Chyba vyhľadávania: ${err.message}\`` v `runAgent` (r. 106) – táto hláška
ide do kontextu agenta a odtiaľ môže presiaknuť do odpovede pre klienta. Voliteľne ju očistiť.

### 2.3 [S] Súkromie: IP a user-agenty — 🟡 **čiastočne**
- ✅ **Retention:** `RETENTION_DAYS` (default 90) + `pruneOldRecords()` spúšťané pri štarte a každých
  24 h (`setInterval`).
- ⚠️ IP sa stále ukladá **raw** (`ip` TEXT). Odporúča sa hash-anonymizácia (SHA-256 + salt / /24
  maska) pre GDPR a zníženie dopadu prípadného úniku DB.
- ⚠️ `user_agent` a `ip` sa vypisujú na `/history` (za basic_auth) – v poriadku pre vlastníka, ale
  pri anonymizácii by sa zároveň neukazovali plné údaje.

### 2.4 [S] CORS `*` — ⚠️ **otvorené**
`origin: process.env.CORS_ORIGIN || "*"` (r. 122–123) zostáva. Pre verejnú službu bez auth nie je
priamou vulnerabilitou, ale odporúča sa nastaviť `CORS_ORIGIN` na konkrétnu doménu (najmä keď
niekedy pribudne session/cookie auth).

### 2.5 [S] Hardening Docker / pinning — ✅ **vyriešené**
Nový jednotný `Dockerfile`:
- ⚠️ `npm ci` v oboch stage `/` (`--omit=dev` pre backend) → reprodukovateľný build. ✅
- Pinnovaný `node:20-bookworm-slim`. ✅ (výslovne nie `:latest`)
- Finálny image beží ako **`USER node`** + adresár `/app/data` s `chown node:node`. ✅
- Pridaný `HEALTHCHECK` (fetch `/health`). ✅
- Žiadne `VITE_*` / API secret v imidži. ✅
- Frontend sa servíruje cez Express (`public/`), nginx a jeho konfigurácia boli odstránené. ✅
  (Pozn.: bezpečnostné hlavičky teraz nastavuje Caddy, nie nginx.)
- V build stage je `apt-get install` python3/make/g++ pre `better-sqlite3` – prítomnosť kompilátora
  v stage je separátny a z finálneho image je odstránený. ✅

### 2.6 [S] CI/CD — build + test — ✅ **vyriešené**
Pribudol `.github/workflows/build.yml` popri `security.yml` (gitleaks + npm audit). Overené:
`backend-test` (vitest `npm test`) **aj** `frontend-build` (vite build) sa v CI spúšťajú. ✅

### 2.7 [S] Rate limit na statiku/health — 🟡 **čiastočne**
Globálny limiter (`app.use(limiter)`, max 120/min) stále pokrýva `/`, `/health` a statiku. Keďže
frontend/statika sa teraz servíruje cez Express (nie nginx), možno je to žiaduce. Voliteľne aplikovať
rýchly limiter len na `/api/` a statiku/health obsluhovať bez limitu (alebo s oveľa vyšším).

---

## 3. Nízke / Udržiavacie

### 3.1 [N] Timing-safe porovnanie tokenu — ✅ **bezpredmetné**
Token bol odstránený (1.2); bod neplatí. (Ak by niekedy pribudla admin auth, použiť
`crypto.timingSafeEqual`.)

### 3.2 [N] Nevyužitá závislosť `@anthropic-ai/sdk` — ⚠️ **otvorené**
Overené: `@anthropic-ai/sdk ^0.39.0` je **stále v** `backend/package.json`, ale v kóde sa nikde
nepoužíva (agent beží cez OpenAI-kompat. DeepSeek). Odstrániť → menšia útočná plocha a menší
`npm audit` povrch.

### 3.3 [N] Log hygiene
Drobné de-identifikované logy; bez akútnej zmeny.

### 3.4 [N] Nominatim / OpenStreetMap policy
Frontend volá OSM Nominatim – držať UA, cache a rate-limit žiadostí. Prevádzkové, nie bezpečnostné.

### 3.5 [N] SPA fallback `app.get("*")`
V poriadku; testy overujú, že `/api/neznamy` → 404.

### 3.6 [N] `SECURITY.md`
✅ **Aktualizovaný** na remote (prepísaný na model verejnej služby – server prompty, denné kvóty,
budget). Udržiavať v súlade so `SECURITY-ANALYSIS.md`.

---

## 4. Aktualizovaný akčný plán (zostávajúce odporúčania)

**Priorita 1 (odporúčané):**
- 🟡 **Anonymizácia IP** v `db.js` (hash IP / /24 maska) – GDPR a zníženie dopadu úniku.
- 🟡 **Definovať `trust proxy` presnejšie** (namiesto `1`) na základe topológie za Caddy.
- 🟡 **Očistiť `err.message` v `runAgent`** (hláška vyhľadávania ide do odpovede).

**Priorita 2 (nízko-nákladné vylepšenia):**
- ⚠️ **Nastaviť `CORS_ORIGIN`** na konkrétnu doménu namiesto `*`.
- 🟡 Prípadne **limiter** len na `/api/`, statiku/health nechať bez limitu (alebo vyšší strop).
- ⚠️ Overiť **CSP syntax v Caddy labels** (úvodzovky) a že hlavička sa naozaj aplikuje.
- ⚠️ Overiť/odstrániť **`@anthropic-ai/sdk`** ak je nepoužitý.
- 🟡 Prípadne doplniť **tokenový budget** (denný strop na vstup/výstup tokenov) do dennej kvóty.

**Všetky kritické a väčšina stredných nálezov je už implementovaná** – toto sú len dorovnávacie body.

---

## 5. Čo je už v poriadku (keep)

- ✔ SQLite cez **prepared statements** → odolný voči SQL injection.
- ✔ Body size limit `1mb`.
- ✔ Denná kvóta na IP (15) + globálny denný strop (300) v SQLite + per-minútové limitery.
- ✔ Serverové promptovanie (`prompts.js`) – klient nekontroluje `system`/`max_tokens`.
- ✔ React escapuje dáta – žiadne `dangerouslySetInnerHTML` na fronte.
- ✔ Kompletná `esc()` na `/history`.
- ✔ Bezpečnostné hlavičky + CSP + HSTS cez Caddy.
- ✔ Docker: `npm ci`, pinnovaný Node, non-root `USER node`, `HEALTHCHECK`, žiadne secret v imidži.
- ✔ Retention záznamov (90 dní, auto-prune).
- ✔ gitleaks + npm audit + build (CI).
- ✔ Testy servera (prompt/max_tokens kontrola) a smoke testy.

---

*Táto analýza predpokladá model „verejná služba bez prihlasovania".* Odporúčania rešpektujú zásadu,
že tajné kľúče (DeepSeek/Tavily) sa nikdy nepíšu do súborov v repozitári a zostávajú len v `.env`
nasadeného prostredia.
