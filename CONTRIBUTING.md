# Contributing

## Vetvy

Vývoj prebieha priamo na `main` (jediná vetva). AI model: **DeepSeek V3** cez OpenAI-kompatibilné SDK + Tavily Search.

## Lokálny vývoj

```bash
cp .env.example .env
# Vyplň DEEPSEEK_API_KEY, TAVILY_API_KEY

# Backend
cd backend && npm install && npm run dev

# Frontend (nový terminál)
cd frontend && npm install && npm run dev
```

Frontend beží na `http://localhost:5173`, backend na `http://localhost:3001`.

## Testy

```bash
# Unit testy backendu
cd backend && npm test

# Smoke testy (vyžaduje bežiaci kontajner)
npm run test:all
```

Každá zmena backendu musí prejsť unit testami bez chýb.

## Štýl kódu

- JavaScript bez TypeScriptu
- React funkčné komponenty, žiadne triedy
- Inline štýly v JSX (žiadny externý CSS framework)
- Komentáre len kde je dôvod nie-zrejmý

## Commit správy

```
feat: krátky popis
fix: krátky popis
docs: krátky popis
refactor: krátky popis
```

## Bezpečnosť

Tokeny a heslá patria do `.env`, nie do kódu ani commitov.
Citlivé nálezy hlásiť podľa [SECURITY.md](SECURITY.md).
