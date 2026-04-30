import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Za reverzným proxy (nginx, Caddy, Docker bridge)
app.set("trust proxy", 1);

// ─── Anthropic klient ────────────────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Príliš veľa požiadaviek. Skús o chvíľu." },
});
app.use("/api/", limiter);

// Voliteľná ochrana tajným tokenom
const authMiddleware = (req, res, next) => {
  if (!process.env.API_SECRET_TOKEN) return next();
  const token = req.headers["x-api-token"];
  if (token !== process.env.API_SECRET_TOKEN) {
    console.warn(`[Auth] 401 – nesprávny x-api-token | IP: ${req.ip} | path: ${req.path}`);
    return res.status(401).json({ error: "Neoprávnený prístup." });
  }
  next();
};

// ─── Statické súbory frontendu ───────────────────────────────────────────────
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    const { model, max_tokens, system, tools, messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Chýba pole messages." });
    }
    const response = await anthropic.messages.create({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: max_tokens || 4000,
      system,
      tools,
      messages,
    });
    res.json(response);
  } catch (err) {
    console.error("[Anthropic Error]", err.message);
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Interná chyba servera." });
  }
});

// API 404 — nechytaj SPA fallbackom
app.use("/api/", (req, res) => {
  res.status(404).json({ error: "Endpoint nenájdený." });
});

// SPA fallback — všetky ostatné cesty vrátia index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ─── Spustenie ──────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`✅ CycloAgent beží na porte ${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);
    console.log(`   Statické súbory: ${publicDir}`);
    if (process.env.API_SECRET_TOKEN) {
      console.log(`   Auth token: aktívny`);
    }
  });
}

export default app;
