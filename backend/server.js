import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);

// ─── DeepSeek klient (OpenAI-compatible API) ─────────────────────────────────
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

// ─── Tavily web search ────────────────────────────────────────────────────────
async function tavilySearch(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = await res.json();
  const results = (data.results || [])
    .map(r => `**${r.title}**\n${r.url}\n${r.content}`)
    .join("\n\n---\n\n");
  return data.answer ? `${data.answer}\n\n${results}` : results;
}

// ─── Definícia nástroja pre DeepSeek ─────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Vyhľadaj aktuálne informácie na webe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Vyhľadávací dotaz" },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Agentic loop ─────────────────────────────────────────────────────────────
async function runAgent({ system, messages, max_tokens }) {
  const history = [
    { role: "system", content: system },
    ...messages,
  ];

  for (let i = 0; i < 10; i++) {
    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: max_tokens || 4000,
      tools: TOOLS,
      tool_choice: "auto",
      messages: history,
    });

    const msg = response.choices[0].message;
    history.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content;
    }

    for (const call of msg.tool_calls) {
      const { query } = JSON.parse(call.function.arguments);
      let result;
      try {
        result = await tavilySearch(query);
      } catch (err) {
        result = `Chyba vyhľadávania: ${err.message}`;
      }
      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  throw new Error("Agent prekročil maximálny počet krokov.");
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"],
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Príliš veľa požiadaviek. Skús o chvíľu." },
});
app.use("/api/", limiter);

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
    const { system, messages, max_tokens } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Chýba pole messages." });
    }

    const text = await runAgent({ system, messages, max_tokens });

    // Vrátime rovnaký formát ako Anthropic API, aby frontend netreba meniť
    res.json({ content: [{ type: "text", text }] });
  } catch (err) {
    console.error("[DeepSeek Error]", err.message);
    res.status(500).json({ error: err.message || "Interná chyba servera." });
  }
});

app.use("/api/", (req, res) => {
  res.status(404).json({ error: "Endpoint nenájdený." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ─── Spustenie ──────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`✅ CycloAgent (DeepSeek) beží na porte ${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);
    if (process.env.API_SECRET_TOKEN) console.log(`   Auth token: aktívny`);
  });
}

export default app;
