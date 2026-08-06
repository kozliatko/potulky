# Security Policy

## Hlásenie zraniteľností

Bezpečnostné zraniteľnosti hláste **súkromne** na: jan.vajda@gmail.com

Prosím neuverejňujte zraniteľnosť ako verejný GitHub issue.

V správe uveďte:
- Popis zraniteľnosti a jej potenciálny dopad
- Kroky na reprodukciu
- Ak je možné, návrh opravy

## Rozsah

| Oblasť | Pokrytá |
|--------|---------|
| Backend API (`/api/messages`) | ✅ |
| `/history` (Caddy basic_auth) | ✅ |
| Rate limiting | ✅ |
| Frontend (React/Vite) | ✅ |
| Docker / deployment konfigurácia | ✅ |

## Aktuálne opatrenia

- `/api/messages` chránené voliteľným `x-api-token` (hlavička, v produkcii povinné — appka odmietne naštartovať bez `API_SECRET_TOKEN`)
- `/history` chránené samostatne cez Caddy `basic_auth` (path-scoped na `/history*`, bcrypt hash v `.env`) — token sa nikdy nedostane do frontend bundlu
- Rate limit: globálny 120 req/min, API 20 req/min na IP
- Fail2ban blokuje skenery na základe Caddy access logov
- Citlivé premenné výhradne cez `.env` (nie v kóde)
- TLS zabezpečené automaticky cez Let's Encrypt (caddy-docker-proxy)
- SQLite databáza uložená v Docker volume (nie v repozitári)
