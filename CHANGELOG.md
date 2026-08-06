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

### Fixed
- Klikateľné zdroje — validácia URL cez `new URL()`, neplatné hodnoty zobrazené ako `<span>`

### Removed
- `caddy/Caddyfile` a `caddy/Dockerfile` — nahradené caddy-docker-proxy labelmi
- `certs/` adresár — certifikáty nepatria do repozitára

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
- Projekt premenovaný: **BikeAgent → Potulky** (potulky.kozliatko.sk)
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
