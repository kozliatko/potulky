# Security Policy

## Hlásenie zraniteľností

Bezpečnostné zraniteľnosti hláste **súkromne** na: jan.vajda@gmail.com

Prosím neuverejňujte zraniteľnosť ako verejný GitHub issue.

V správe uveďte:
- Popis zraniteľnosti a jej potenciálny dopad
- Kroky na reprodukciu
- Ak je možné, návrh opravy

## Model dôvery

Potulky je **verejná služba bez prihlasovania** — `/api/messages` nie je chránené tokenom.
Ochrana proti zneužitiu (prompt injection, únik nákladov na DeepSeek/Tavily) beží
na serveri, nie na klientovi:

- Server si **sám skladá system prompt** aj používateľskú správu (`backend/prompts.js`)
  z `mode` + `profile` + `location`. Klient nemôže poslať vlastný `system` ani `messages`.
- `max_tokens` je natvrdo `8000`, nedá sa prepísať klientom.
- `profile` sa validuje proti whitelistu boolean polí (neznáme/škodlivé kľúče sa ignorujú).
- `location` sa orezáva na 200 znakov.

## Rozsah

| Oblasť | Pokrytá |
|--------|---------|
| Backend API (`/api/messages`) | ✅ |
| `/history` (Caddy basic_auth) | ✅ |
| Rate limiting a denné kvóty | ✅ |
| Frontend (React/Vite) | ✅ |
| Docker / deployment konfigurácia | ✅ |

## Aktuálne opatrenia

- **Server-side prompt building** — klient neposiela `system`/`messages`/`max_tokens`, len `mode`/`profile`/`location` (pozri vyššie)
- **Rate limiting** — globálny 120 req/min, API 20 req/min na IP
- **Denné kvóty** — `MAX_REQUESTS_PER_IP_PER_DAY` (default 15, → `429`), `MAX_GLOBAL_REQUESTS_PER_DAY` (default 300, → `503`)
- **`/history`** chránené výhradne cez Caddy `basic_auth` (path-scoped na `/history*`, bcrypt hash v `.env`) — appka nie je zvonka dosiahnuteľná bez Caddy (žiadny `ports:` mapping)
- **XSS prevencia** — všetky interpolované polia v `/history` HTML výstupe (ip, location, status) sú escapované
- **CSP + bezpečnostné hlavičky** cez Caddy (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`)
- **Retencia dát** — záznamy histórie staršie ako `HISTORY_RETENTION_DAYS` (default 90 dní) sa automaticky mažú
- **CORS** obmedzené na produkčnú doménu (`CORS_ORIGIN`)
- **Generické chybové hlásenia** klientovi — interné detaily (`err.message`) idú len do serverových logov
- **Fail2ban** blokuje skenery na základe Caddy access logov
- **SQL injection** — všetky DB dotazy cez prepared statements (better-sqlite3)
- Citlivé premenné výhradne cez `.env` (nie v kóde, `.gitignore` pokrýva `.env`)
- TLS automaticky cez Let's Encrypt (caddy-docker-proxy)
- SQLite databáza uložená v Docker volume (nie v repozitári)
- CI (`gitleaks` + `npm audit`) kontroluje uniknuté secrets a zraniteľné závislosti pri každom pushi
