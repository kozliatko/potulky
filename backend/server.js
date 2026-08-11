import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { insertSearch, getHistory, getStats, requestsTodayByIp, requestsToday, requestsTodayByIpBreakdown, pruneOldRecords } from "./db.js";
import { buildPrompt } from "./prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const MAX_TOKENS = 8000;
const MAX_REQUESTS_PER_IP_PER_DAY = Number(process.env.MAX_REQUESTS_PER_IP_PER_DAY) || 15;
const MAX_GLOBAL_REQUESTS_PER_DAY = Number(process.env.MAX_GLOBAL_REQUESTS_PER_DAY) || 300;

// Cenový model DeepSeek + Tavily (zhodné s frontend/src/components/shared.jsx)
const PRICE_INPUT  = 0.27 / 1_000_000;
const PRICE_OUTPUT = 1.10 / 1_000_000;
const PRICE_SEARCH = 0.01;
const calcCost = (inputTokens, outputTokens, searchCount) =>
  (inputTokens || 0) * PRICE_INPUT + (outputTokens || 0) * PRICE_OUTPUT + (searchCount || 0) * PRICE_SEARCH;

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
    .map(r => `**${r.title}**\n${r.url}\n${r.content.slice(0, 800)}`)
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
async function runAgent({ system, userMessage }) {
  const history = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];

  let inputTokens  = 0;
  let outputTokens = 0;
  let searchCount  = 0;

  for (let i = 0; i < 25; i++) {
    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: MAX_TOKENS,
      tools: TOOLS,
      tool_choice: "auto",
      messages: history,
    });

    if (response.usage) {
      inputTokens  += response.usage.prompt_tokens     || 0;
      outputTokens += response.usage.completion_tokens || 0;
    }

    const msg = response.choices[0].message;
    history.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content, usage: { inputTokens, outputTokens, searchCount } };
    }

    for (const call of msg.tool_calls) {
      const { query } = JSON.parse(call.function.arguments);
      let result;
      if (searchCount >= 10) {
        result = "Limit vyhľadávaní dosiahnutý. Zosumarizuj výsledky, ktoré už máš.";
      } else {
        searchCount++;
        try {
          result = await tavilySearch(query);
        } catch (err) {
          result = `Chyba vyhľadávania: ${err.message}`;
        }
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
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Príliš veľa požiadaviek. Skús o chvíľu." },
});
app.use(limiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Príliš veľa požiadaviek. Skús o chvíľu." },
});
app.use("/api/", apiLimiter);

// ─── Statické súbory frontendu ───────────────────────────────────────────────
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/messages", async (req, res) => {
  const start = Date.now();
  const ip = req.ip;
  const userAgent = req.headers["user-agent"] || null;

  const { mode, profile, location: rawLocation } = req.body || {};
  const prompt = buildPrompt(mode, profile, rawLocation);
  if (!prompt) {
    console.warn(`[Invalid] 400 – neplatné mode/location | IP: ${ip} | mode: ${mode} | body keys: ${Object.keys(req.body || {}).join(",")}`);
    return res.status(400).json({ error: "Neplatná požiadavka — chýba alebo je neplatné mode/location." });
  }

  if (requestsToday() >= MAX_GLOBAL_REQUESTS_PER_DAY) {
    return res.status(503).json({ error: "Denný limit vyhľadávaní služby bol dosiahnutý. Skús to zajtra." });
  }
  if (requestsTodayByIp(ip) >= MAX_REQUESTS_PER_IP_PER_DAY) {
    return res.status(429).json({ error: "Dosiahol si denný limit vyhľadávaní pre túto IP adresu. Skús to zajtra." });
  }

  try {
    const { text, usage } = await runAgent({ system: prompt.system, userMessage: prompt.userMessage });

    insertSearch.run(
      ip, userAgent, prompt.location,
      usage.searchCount, usage.inputTokens, usage.outputTokens,
      Date.now() - start, "ok", null
    );

    res.json({ content: [{ type: "text", text }], usage });
  } catch (err) {
    console.error("[DeepSeek Error]", err.message);
    insertSearch.run(
      ip, userAgent, prompt.location,
      0, 0, 0, Date.now() - start, "error", err.message?.slice(0, 255)
    );
    res.status(500).json({ error: "Interná chyba servera." });
  }
});

app.get("/history", (req, res) => {
  const rows  = getHistory();
  const stats = getStats();
  const globalToday  = requestsToday();
  const ipBreakdown  = requestsTodayByIpBreakdown();

  const fmt = iso => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("sk-SK", { timeZone: "Europe/Bratislava", hour12: false });
  };
  const ms = v => v != null ? `${v} ms` : "—";
  const num = v => v != null ? v.toLocaleString("sk-SK") : "0";
  const money = v => "$" + v.toFixed(4);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const rows_html = rows.map(r => `
    <tr class="${r.status === 'error' ? 'err' : ''}">
      <td>${r.id}</td>
      <td>${fmt(r.created_at)}</td>
      <td>${r.ip ? esc(r.ip) : "—"}</td>
      <td class="loc">${r.location ? esc(r.location) : "—"}</td>
      <td>${r.search_count ?? 0}</td>
      <td>${num(r.input_tokens)}</td>
      <td>${num(r.output_tokens)}</td>
      <td>${ms(r.duration_ms)}</td>
      <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
    </tr>`).join("");

  const globalPct = Math.min(100, Math.round((globalToday / MAX_GLOBAL_REQUESTS_PER_DAY) * 100));
  const totalSpendToday = ipBreakdown.reduce(
    (sum, r) => sum + calcCost(r.total_input_tokens, r.total_output_tokens, r.total_searches), 0
  );

  const ip_rows_html = ipBreakdown.map(r => {
    const cost = calcCost(r.total_input_tokens, r.total_output_tokens, r.total_searches);
    const ipPct = Math.min(100, Math.round((r.request_count / MAX_REQUESTS_PER_IP_PER_DAY) * 100));
    return `
    <tr class="${ipPct >= 100 ? 'err' : ''}">
      <td>${r.ip ? esc(r.ip) : "—"}</td>
      <td>${r.request_count} / ${MAX_REQUESTS_PER_IP_PER_DAY}</td>
      <td>${r.total_searches ?? 0}</td>
      <td>${num(r.total_input_tokens)}</td>
      <td>${num(r.total_output_tokens)}</td>
      <td>${money(cost)}</td>
    </tr>`;
  }).join("");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BikeAgent — História vyhľadávaní</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#064e3b;padding:24px}
  h1{font-size:1.4rem;margin-bottom:20px}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}
  .stat{background:#fff;border:1px solid #d1fae5;border-radius:10px;padding:12px 18px;min-width:130px}
  .stat .val{font-size:1.5rem;font-weight:700;color:#059669}
  .stat .lbl{font-size:.75rem;color:#6b7280;margin-top:2px}
  .filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center}
  .filters input,.filters select{padding:6px 10px;border:1px solid #d1fae5;border-radius:8px;font-size:.82rem;color:#064e3b;background:#fff;outline:none}
  .filters input:focus,.filters select:focus{border-color:#059669;box-shadow:0 0 0 2px #d1fae5}
  .filters input[type=text]{min-width:180px}
  #count{font-size:.78rem;color:#6b7280;margin-left:auto}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  th{background:#059669;color:#fff;text-align:left;padding:10px 12px;font-size:.8rem;white-space:nowrap}
  td{padding:8px 12px;font-size:.82rem;border-bottom:1px solid #f0fdf4;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#f0fdf4}
  tr.err td{background:#fef2f2}
  tr.hidden{display:none}
  .loc{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.75rem;font-weight:600}
  .badge.ok{background:#d1fae5;color:#065f46}
  .badge.error{background:#fee2e2;color:#991b1b}
  @media(max-width:700px){th:nth-child(5),td:nth-child(5),th:nth-child(6),td:nth-child(6),th:nth-child(7),td:nth-child(7){display:none}}
  .tabs{display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid #d1fae5}
  .tab-btn{padding:10px 18px;border:none;background:none;font-size:.88rem;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}
  .tab-btn.active{color:#059669;border-bottom-color:#059669}
  .tab-panel{display:none}
  .tab-panel.active{display:block}
  .progress{background:#f0fdf4;border:1px solid #d1fae5;border-radius:8px;height:10px;overflow:hidden;margin-top:8px}
  .progress-fill{height:100%;background:#059669;transition:width .3s}
  .progress-fill.warn{background:#d97706}
  .progress-fill.full{background:#dc2626}
</style>
</head>
<body>
<h1>🚴 BikeAgent — História vyhľadávaní</h1>
<div class="tabs">
  <button class="tab-btn active" id="tab-btn-history" data-tab="history">📋 História</button>
  <button class="tab-btn" id="tab-btn-quotas" data-tab="quotas">📊 Kvóty a náklady</button>
</div>

<div class="tab-panel active" id="tab-history">
<div class="stats">
  <div class="stat"><div class="val">${num(stats.total)}</div><div class="lbl">Celkom požiadaviek</div></div>
  <div class="stat"><div class="val">${num(stats.ok_count)}</div><div class="lbl">Úspešných</div></div>
  <div class="stat"><div class="val">${num(stats.error_count)}</div><div class="lbl">Chýb</div></div>
  <div class="stat"><div class="val">${num(stats.unique_ips)}</div><div class="lbl">Unikátnych IP</div></div>
  <div class="stat"><div class="val">${num(stats.total_web_searches)}</div><div class="lbl">Web vyhľadávaní</div></div>
  <div class="stat"><div class="val">${stats.avg_duration_ms != null ? Math.round(stats.avg_duration_ms / 1000) + ' s' : '—'}</div><div class="lbl">Priemerná odozva</div></div>
</div>
<div class="filters">
  <input type="text"   id="f-loc"    placeholder="🔍 Lokalita…">
  <input type="text"   id="f-ip"     placeholder="🔍 IP adresa…">
  <input type="text"   id="f-date"   placeholder="🔍 Dátum (napr. 2026-05)…">
  <select id="f-status">
    <option value="">Všetky stavy</option>
    <option value="ok">ok</option>
    <option value="error">error</option>
  </select>
  <button id="f-clear" style="padding:6px 12px;border:1px solid #d1fae5;border-radius:8px;background:#fff;font-size:.82rem;color:#6b7280;cursor:pointer">✕ Zrušiť</button>
  <span id="count"></span>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Čas</th><th>IP</th><th>Lokalita</th>
    <th>Hľadaní</th><th>Vstup tok.</th><th>Výstup tok.</th>
    <th>Trvanie</th><th>Stav</th>
  </tr></thead>
  <tbody id="tbody">${rows_html || '<tr><td colspan="9" style="text-align:center;padding:24px;color:#9ca3af">Zatiaľ žiadne záznamy</td></tr>'}</tbody>
</table>
</div>

<div class="tab-panel" id="tab-quotas">
<div class="stats">
  <div class="stat"><div class="val">${globalToday} / ${MAX_GLOBAL_REQUESTS_PER_DAY}</div><div class="lbl">Globálne požiadavky dnes</div></div>
  <div class="stat"><div class="val">${money(totalSpendToday)}</div><div class="lbl">Odhadovaná útrata dnes</div></div>
  <div class="stat"><div class="val">${num(ipBreakdown.length)}</div><div class="lbl">Aktívnych IP dnes</div></div>
  <div class="stat"><div class="val">${MAX_REQUESTS_PER_IP_PER_DAY}</div><div class="lbl">Limit na IP / deň</div></div>
</div>
<div style="background:#fff;border:1px solid #d1fae5;border-radius:10px;padding:16px 18px;margin-bottom:20px">
  <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#6b7280;margin-bottom:4px">
    <span>Globálny denný limit</span><span>${globalToday} / ${MAX_GLOBAL_REQUESTS_PER_DAY} (${globalPct}%)</span>
  </div>
  <div class="progress"><div class="progress-fill ${globalPct >= 100 ? 'full' : globalPct >= 80 ? 'warn' : ''}" style="width:${globalPct}%"></div></div>
</div>
<table>
  <thead><tr>
    <th>IP</th><th>Požiadaviek dnes</th><th>Vyhľadávaní</th>
    <th>Vstup tok.</th><th>Výstup tok.</th><th>Odhad. útrata</th>
  </tr></thead>
  <tbody>${ip_rows_html || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#9ca3af">Dnes zatiaľ žiadne požiadavky</td></tr>'}</tbody>
</table>
</div>

<script src="/history.js"></script>
</body>
</html>`);
});

app.use("/api/", (req, res) => {
  res.status(404).json({ error: "Endpoint nenájdený." });
});

// Express 5 / path-to-regexp v8: holé "*" už nie je platný vzor cesty,
// pomenovaný wildcard v zložených zátvorkách zachytáva aj koreň "/"
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    console.warn(`[Scan] 400 – URIError | IP: ${req.ip} | path: ${req.path}`);
    return res.status(400).end();
  }
  next(err);
});

// ─── Spustenie ──────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pruned = pruneOldRecords();
  if (pruned > 0) console.log(`🧹 Vymazaných ${pruned} starých záznamov histórie.`);
  setInterval(() => pruneOldRecords(), 24 * 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`✅ BikeAgent (DeepSeek) beží na porte ${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);
  });
}

export default app;
