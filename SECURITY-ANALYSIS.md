# Bezpečnostná analýza projektu „potulky"

**Dátum:** 2026-08-07
**Predpoklad:** projekt je verejná služba (**public**, bez prihlasovania používateľov).
**Rozsah:** backend (Express/Node), frontend (React/Vite), infraštruktúra (Docker, Caddy, Nginx), CI/CD.
**Commit použitý pre analýzu:** current `main` (@ `git log` HEAD).

> Skratky: **K** = kritické, **V** = vysoké, **S** = stredné, **N** = nízke.

---

## 0. Zhrnutie (Executive summary)

Projekt prešiel základnými dobrými návykmi: prepared statements v SQLite (SQL-injection bezpečné),
bezpečnostné HTTP hlavičky na Nginx, limit veľkosti tela (1 MB), rate limiting, Docker beží ako
non-root používateľ, žiadne `dangerouslySetInnerHTML` na fronte (React automaticky escapuje),
slovenská podpora. CI má job na gitleaks + npm audit.

**Zásadné problémy vo vzťahu k „verejná služba bez prihlasovania":**

1. **Falošný autentifikačný token (K–V).** Backend v produkcii *vynucuje* `API_SECRET_TOKEN`, ale ten
   je zapálený do verejného frontend bundlu cez `VITE_API_SECRET_TOKEN`. Keďže služba je verejná,
   token si prečíta každý návštevník priamo z JS → „auth" je úplne bezcenný a dáva falošný pocit
   bezpečia. Navyše je to v rozpore s požiadavkou „public bez prihlasovania".
2. **Klient ovláda systém prompt, cele messages a max_tokens (K).** `POST /api/messages` berie
   `{ system, messages, max_tokens }` priamo z tela požiadavky. Verejný útočník môže:
   - prepísať/obísť systémový prompt (prompt injection),
   - nechať agenta robiť ľubovoľné Tavily vyhľadávania (zneužitie platenej API),
   - nastaviť obrovské `max_tokens` (ekonomická/DoS zneužitie).
3. **Žiadny globálny rozpočet / denná kvóta (V).** Jediné limity sú „za minútu" (20/min API, 120/min
   globálne) a dajú sa obísť menením IP / proxiami. Neexistuje denná kvóta na IP ani globálny strop
   nákladov → verejný útočník môže vypáliť rozpočet vlastníka API.
4. **XSS v `/history` (S).** Ukladané polia (IP, status, user_agent) sú vložené do HTML bez escapovania;
   `location` escapuje iba `<`. Ochrana je „len cez Caddy basic_auth".
5. **/history nemá vlastnú autentifikáciu v aplikácii (S).** Spolieha sa výhradne na basic_auth v Caddy
   (path-scoped). Pri priamom prístupe na backend port (napr. docker-compose.dev) je otvorené a uniká
   IP adresy návštevníkov.
6. **Chýba CSP (S).** Nginx má X-Frame-Options, X-Content-Type-Options, Referrer-Policy, ale žiadnu
   Content-Security-Policy.
7. **Únik detailov chýb (S).** `res.status(500).json({ error: err.message })` posiela klientovi
   interné texty chýb (môžu obsahovať cestu sys, meno služby, resp. Tavily hlášky).

Ostatné nálezy (CORS, trust proxy, hardening Docker, pinning verzií, súkromie/GDPR) sú v detaile nižšie.

---

## 1. Kritické / Vysoké (riešiť predtým, než to pôjde na verejný internet)

### 1.1 [K] Klient kontroluje systém prompt a max_tokens → prompt injection a zneužitie nákladov
**Súbor:** `backend/server.js` (okolo riadku 170)
```js
const { system, messages, max_tokens } = req.body;
if (!messages || !Array.isArray(messages)) { ... }
const { text, usage } = await runAgent({ system, messages, max_tokens });
```
**Problém:** `system`, `messages` aj `max_tokens` sú čisto od klienta. Verejný útočník môže:
- poslať systémový prompt, ktorý terču/zmení správanie agenta (prelomenie ohraničenia),
- poslať vlastnú históriu, ktorá agenta vmanipuluje do nekonečného reťazca vyhľadávaní
  (`tavilySearch`) → **platí sa Tavily aj DeepSeek API**,
- dať `max_tokens` na maximum → drahé odpovede.

**Odporúčanie (verejná služba):**
1. **Nikdy nepreberať `system` ani `max_tokens` od klienta.** Backend si zostaví systémový prompt
   sám (fixné inštrukcie + ciele bezpečnosti). Vzťahovať sa na pevne definovaný bezpečnostný rámec.
2. **Stropovať `max_tokens` na serveri** (napr. `Math.min(max_tokens ?? 8000, 8000)`) a vždy ho
   vynútiť — nikdy nie priamo z tela.
3. **Meníť `messages`:** očistiť klientské vstupy, prijať iba `role: "user" | "assistant"` sanity-check,
   rezať dĺžku každej správy a celého pola, obmedziť počet správ.
4. **Zaviesť serverové stropy runAgent:** už existuje limit 10 vyhľadávaní a max 25 krokov — znížiť
   ich a nastaviť tvrdý strop celkových tokenov + celkového času.

### 1.2 [K] Falošná autentifikácia cez verejný token
**Súbor:** `backend/server.js` (riadky ~145–153, ~13–15), `frontend/src/components/BikeAgent.jsx:174–175`,
`HikeAgent.jsx:178–179`, `frontend/Dockerfile` (ARG/ENV `VITE_API_SECRET_TOKEN`), `docker-compose.yml`.

**Problém:** Token `API_SECRET_TOKEN` sa predáva do bundlu cez `VITE_API_SECRET_TOKEN`. Všetci návštevníci
ho majú v JS. `authMiddleware` potom vráti 401 každému, kto nemá token — čo je pre legitímneho používateľa
blokujúce a pre útočníka triviálne obídateľné. V production navyše `if (NODE_ENV==="production" &&
!process.env.API_SECRET_TOKEN) throw` **núti** nastaviť token aj keď to má byť verejná služba.

**Odporúčanie (verejná služba bez prihlasovania):**
- **Odstrániť `C`1 úplne.** Pre verejnú službu je to mŕtva a zavádzajúca vrstva.
- Zachovať resp. presunúť ochranu do vrstiev, ktoré naozaj fungujú bez prihlasovania:
  - **serverové zostavenie promptov** (bod 1.1),
  - **prísne rate limiting + denné kvóty** (bod 1.3),
  - **globálny budget nákladov** (bod 1.3),
  - Web Application Firewall / edge ochranu (Caddy + fail2ban) pri public nasadení.
- Ak by ste naozaj chceli obmedziť prístup k endpointu, použite skutočný mechanizmus (session, CAPTCHA
  / Turnstile) — nie verejne známy token.
- Odstrániť produkčnú podmienku `throw`, prípadne ju nahradiť zmysluplnejšou kontrolou (napr.
  vyžadovať `DEEPSEEK_API_KEY` a `TAVILY_API_KEY`).

### 1.3 [V] Slabý rate limiting a neexistujúci cenový rozpočet pre verejné API
**Súbor:** `backend/server.js` (limitery okolo r. 127–143)
```js
const limiter = rateLimit({ windowMs: 60*1000, max: 120, ... });   // globálne "/"
app.use(limiter);
const apiLimiter = rateLimit({ windowMs: 60*1000, max: 20 });      // "/api/"
app.use("/api/", apiLimiter);
```
**Problém:** Limity sú len „per minútu" a identifikácia IP pri `trust proxy` môže byť zneužitá
(bod 1.5). Útočník meniaci IP / používajúci botnet prejde ľahko. Navyše nie je žiadny **denný** limit
a žiadny **globálny strop nákladov** pre agenta (DeepSeek + Tavily sú platené).

**Odporúčanie:**
1. **Denná kvóta na IP** (napr. pomocou rozšírenej cache key: IP + deň). Presunúť si „cost" stav do
   SQLite alebo Redis a inkrementovať.
2. **Globálny denný rozpočet v eurách/tokenoch** — ak sa prekročí, agent sa vypne / vráti
   „služba dočasne nedostupná" (vestav do `runAgent` aj na vstupe `/api/messages`).
3. **`apiLimiter.max` znížiť** (20/min na agenta je veľa) a pridať **backlog/delay** pre drahé
   operácie. Kľúč determinovať spoľahlivo (Dátum + IP, resp. cez `req.ip` overený za Caddy).
4. **Zaviesť maximálny počet agent behov rovnako na úrovni samotného agentu**, nie len HTTP.

### 1.4 [V] XSS v `/history` (nedostatočné escapovanie, neoverené dáta)
**Súbor:** `backend/server.js` (render `/history`, r. ~218)
```js
r.location.replace(/</g, "&lt;")   // escapuje LEN "<"
```
Ostatné polia (IP, status, user_agent, chybové hlásenia) sú vypísané priamo bez kódovania a do HTML
sa vkladá kontext; stránka je čisto `text/html`.

**Problém:** ak sa do DB dostane kontrolovaný reťazec (napr. cez `user-agent`, IP cez `X-Forwarded-For`
pri priamom prístupe, alebo cez pola správy), stránka môže vykonať markup. Ochrana je dnes „iba Caddy
basic_auth" — čo je slabá obranná vrstva (defense-in-depth porušené).

**Odporúčanie:**
- Escapovať **všetky** interpolované hodnoty (`&`, `<`, `>`, `"`, `'`) vo funkcii `esc()` a použiť
  ju na každé pole v šablóne `/history`.
- Prípadne stránku renderovať ako JSON + render na fronte (React escapuje sám).
- `/history` držať za **skutočnou** autentifikáciou (Caddy basic_auth je OK pre vlastníka, ale default
  is too weak — pozri 1.6).

### 1.5 [V] `trust proxy` + expozícia backend portu → obídenie limitu a IP spoofing
**Súbor:** `backend/server.js` (r. 17 `app.set("trust proxy", 1)`), `docker-compose.dev.yml` (mapuje
`3001:3001` a `5173:5173`).

**Problém:** Pri `trust proxy: 1` berie Express IP z `X-Forwarded-For` a verte prvému hopu. Keď je
backend port verejne exponovaný (`docker-compose.dev.yml` mapuje 3001), útočník môže poslať vlastnú
hlavičku `X-Forwarded-For` a **zmeniť si „IP"** — čím obíde rate limiting a zapíše falošnú IP do
histórie.

**Odporúčanie:**
- **Nikdy nemapovať `backend:3001` verejne.** V dev používať len 5173 (frontend proxy na `/api`) je OK.
- Overiť `X-Forwarded-For` / použiť `trust proxy` iba keď je reálne proxy pred commitom, a nastaviť
  pevný počet hops (napr. `"loopback, linklocal, uniquelocal"` alebo konkrétny proxy IP).
- V produkcii nepovoliť priame spojenie na backend z internetu — len cez Caddy/Nginx.

### 1.6 [V] `/history` bez vlastnej autentifikácie v aplikácii
**Súbor:** `backend/server.js` (r. 201 — `/history` nemá `authMiddleware`; iba `/api/messages` ho má),
`docker-compose.yml` (Caddy `@history_path` + basic_auth).

**Problém:** Autentifikácia histórie je **iba** na úrovni Caddy (path `history*`). Ak sa backend
zverejní/prilnú porty (pozri 1.5), `/history` je otvorené a zverejňuje **IP adresy**, user-agenty
a históriu vyhľadávaní všetkých návštevníkov (súkromný údaj).

**Odporúčanie:**
- Pridať **vlastnú autorizáciu aj v aplikácii** (napr. `API_ADMIN_TOKEN` len pre `/history`, overovaný
  timing-safe), t.j. defense-in-depth popri Caddy.
- Aspoň **neukladať plné IP adresy** (bod 2.3 – súkromie) alebo ich šifrovať/hash-ovať.
- Nezverejňovať `/history` vôbec — má to byť súkromný endpoint vlastníka.

---

## 2. Stredné (odporúča sa riešiť)

### 2.1 [S] Chýba Content-Security-Policy (CSP)
**Súbor:** `frontend/nginx.conf` — sú pridané `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, ale **nie CSP**.

**Odporúčanie:** Pridať CSP hlavičku, napr.:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://*.open-meteo.com;
```
(Prispôsobiť tak, aby nezablokoval Leaflet / Open-Meteo / Nominatim a PWA service worker.)
CSP je dôležitá defensívna vrstva proti XSS (aj keď React escapuje, jedna chyba ju eliminuje).

### 2.2 [S] Únik interných chýb
**Súbor:** `backend/server.js` (r. 197 a catch bloky)
```js
res.status(500).json({ error: err.message || "Interná chyba servera." });
```
**Problém:** `err.message` môže obsahovať cesty súborov, názvy modulov, tavily/OpenAI hlášky — klient
dostáva interné detaily, ktoré pomáhajú útočníkovi (informačný leak).

**Odporúčanie:** Vráť generický `{ error: "Interná chyba servera." }` a detaily logovať len na server
(`console.error`). Konkrétne chybové kódy (napr. 400/401) vrátiť tam, kde to je bezpečné a deterministické.

### 2.3 [S] Súkromie: ukladanie plných IP adries a user-agentov
**Súbor:** `backend/db.js` (schéma: `ip`, `user_agent`, `location`), `backend/server.js` (INSERT).

**Problém:** Verejná služba zbiera a ukladá osobné údaje (IP, UA) bez možnosti ich vymazať —
GDPR/súkromie. Naviac je to doplnkový zdroj údajov v prípade úniku DB.

**Odporúčanie:**
- Ukladať IP len **hash-anonymizované** (napr. SHA-256 + salt alebo skrátenú /24 masku).
- Ponúknuť endpoint/CLI pre mazanie starších záznamov (retention / `DELETE FROM searches WHERE ts < ...`).
- Uviesť správcu údajov / cookie zásady, ak to má byť verejná služba v EÚ.

### 2.4 [S] CORS `*`
**Súbor:** `backend/server.js` (r. 122–125)
```js
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", methods: ["GET","POST"] }));
```
**Problém:** Pre verejnú službu to nie je priama vulnerabilita (žiadna cookies/nj stav), ale umožňuje
každému webu posielať požiadavky na API (ktoré je už verejné). Skôr kosmetické, ale ak pridáte session
auth, CORS `*` by bol vážny. 

**Odporúčanie:** Nastaviť `CORS_ORIGIN` na konkrétnu doménu (napr. Caddy/nginx origin) a v dev použiť
origin nastavenie. Nedávať `*` ako default.

### 2.5 [S] Missing hardening Docker / pinning verzií
**Súbor:** `frontend/Dockerfile` (`FROM nginx:alpine`, `npm install` nie `npm ci`),
`backend/Dockerfile`/`Dockerfile` (`node:20-alpine` nepinnované), `docker-compose.yml`.

**Problém:**
- Nepinnované tagy (`node:20-alpine`, `nginx:alpine`) → nemá reprodukovateľný build (supply-chain).
- `npm install` (nie `npm ci`) → nemusí rešpektovať lockfile 1:1.
- Nginx posledný stage beží **ako root** (default) → po kompromitácii má kontajner root.
- V `frontend/Dockerfile` sa navyše kopíruje `ARG/ENV VITE_API_SECRET_TOKEN` do imidžu (v súlade s C1).

**Odporúčanie:**
- Pinnovať image tag na konkrétne verzie (`node:20.19-alpine` / `nginx:1.27-alpine`, ideálne digest).
- Použiť `npm ci --omit=dev` / `--frozen-lockfile` (a `npm audit` v CI — je).
- Nginx stage: `USER` non-root alebo znížené capabilities, žiadne `VITE_*` secret do imidžu.
- Pridať `HEALTHCHECK`.

### 2.6 [S] CI/CD — len security job, no build/test
**Súbor:** `.github/workflows/security.yml` (jediný workflow: gitleaks + npm audit).

**Problém:** Nie je workflow, ktorý by **zbudoval** a **spustil** testy (backend/testy SPA) pri každom
PR/pushe. Bez toho sa dá rozbiť build/testy bez povšimnutia.

**Odporúčanie:** Pridať CI job: `npm ci` → `npm run build` (frontend) → `npm test`/vitest → prípadne
smoke testy proti test env. Bezpečnostné (gitleaks+audit) nechať.

### 2.7 [S] `express-rate-limit` na statické/health endpointy
**Súbor:** `backend/server.js` (globálny limiter `app.use(limiter)` pokrýva `/`, `/health`, statiku).

**Problém:** Store frontend statiku/health limitácii "120/min/IP" — legitímni používatelia s natívnym
cache busting (napr. prerender) môžu byť limitovaní zbytočne; a hlavne to je nesúrodé s tým, že frontend
má vlastný nginx.

**Odporúčanie:** Nechať riešiť edge (nginx/caddy) statické súbory; na API endpointi použiť prísnejší
limiter (už je 20/min). Rozlíšiť „static/public" od „api".

---

## 3. Nízke / Udržiavacie

### 3.1 [N] Timing-safe porovnanie tokenu
**Súbor:** `backend/server.js` (authMiddleware)
```js
if (token !== process.env.API_SECRET_TOKEN)
```
Porovnanie nie je timing-safe. Ak by sa token zachoval (čo neodporúčame), použiť `crypto.timingSafeEqual`
s overenou dĺžkou. (Ak token odstránite podľa 1.2, tento bod odpadá.)

### 3.2 [N] Nevyužitá závislosť
`backend/package.json` obsahuje `@anthropic-ai/sdk`, ktorý sa nepoužíva (agent beží cez OpenAI-kompat.
DeepSeek). Odstrániť → menšia útočná plocha a menší `npm audit` povrch.

### 3.3 [N] Protokolovanie (`console.warn`, IP) — log hygiene
Autorizačné chyby logujú IP — pre verejnú službu v poriadku, ale držte logy de-identifikované a krátko.

### 3.4 [N] Nominatim / OpenStreetMap policy
Frontend volá OSM Nominatim geokódovanie — dodržuje sa UA a limity? Držať cache a obmedziť počet
žiadostí (Nominatim je rate-limited). Nie priamo bezpečnostné, ale prevádzkové.

### 3.5 [N] SPA fallback `app.get("*")`
Vráti index pre každú neznámu cestu — pri `text/html`, ale API `*` by sa malo 404 (testy už overujú
`/api/neznamy` → 404; zachovať). V poriadku, už je riešené.

### 3.6 [N] `SECURITY.md` sa nezhoduje so zámerom „public"
**Súbor:** `SECURITY.md` tvrdí, že `/api/messages` je chránené `x-api-token` a `/history` cez basic_auth.
Pri verejnej službe bez prihlasovania to treba prepísať — popisovať reálny model (server prompt,
denné kvóty, budget). Dokumentácia je „live"; inak zavádza.

---

## 4. Odporúčaný akčný plán (v poradí priority)

**Krok 1 — vyriešiť C1 a C2 (kritické pre verejné nasadenie):**
- Odstrániť `API_SECRET_TOKEN` / `VITE_API_SECRET_TOKEN` z backendu, frontendu, Dockerfile, compose,
  `.env.example`. Zrušiť produkčný `throw` vyžadujúci token.
- Buildovať systém prompt **na serveri**, neprevzatiať `system`, `max_tokens`; stropovať tokeny.

**Krok 2 — cenová ochrana:**
- Denná kvóta na IP + globálny denný budget (preniesť počet vyhľadávaní/tokenov do DB), tvrdšie
  stropy v `runAgent` (menej krokov, menej vyhľadávaní, znížené `max_tokens`).

**Krok 3 — endpointy a dáta:**
- Vlastná autorizácia `/history` v aplikácii (nie len Caddy), escapovanie všetkých poli na `/history`,
  hash/anonymizácia IP, retention politika.

**Krok 4 — infraštruktúra:**
- Nepublikovať `backend:3001`, opraviť `CORS_ORIGIN`, pridať CSP v nginx, spravovať `err.message`,
  pinnovať Docker tagy, `npm ci`, Nginx non-root.

**Krok 5 — CI/CD:**
- Pridať build+test workflow (frontend build, vitest, prípadne smoke testy) popri security jobe.

**Krok 6 — doklady:**
- Prepísať `SECURITY.md`, event. pridať `SECURITY.md` model s ohrozeniami a mitigáciami vyššie.

---

## 5. Čo je už v poriadku (keep)

- ✔ SQLite cez **prepared statements** → odolný voči SQL injection.
- ✔ Body size limit `1mb`.
- ✔ Rate limiting (aj keď treba posilniť dennou kvótou a budgetom).
- ✔ React escaluje dáta — žiadne `dangerouslySetInnerHTML` na fronte.
- ✔ Bezpečnostné hlavičky na Nginx (aj keď chýba CSP).
- ✔ Docker stagey bežia (backend) ako non-root `USER node`.
- ✔ gitleaks + npm audit v CI (bez zistených tajomstiev — kontrola vykonala i prehliadku git histórie).
- ✔ `jsonrepair` a klientske validácie na fronte.
- ✔ Testy ASCII/status kontroly existujú (smoke testy: 400/401, 404 neznámy API, bezpečnostné hlavičky).

---

*Táto analýza predpokladá model „verejná služba bez prihlasovania".* Odporúčania rešpektujú zásadu,
že tajné kľúče (DeepSeek/Tavily) sa nikdy nepíšu do súborov v repozitári a zostávajú len v `.env`
nasadeného prostredia.
