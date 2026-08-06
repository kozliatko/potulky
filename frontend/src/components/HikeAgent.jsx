import { useState } from "react";
import { jsonrepair } from "jsonrepair";
import {
  ROUTE_COLORS, POI_ICONS,
  calcCost, extractFirstJSON,
  RouteMap, WeatherForecast,
} from "./shared.jsx";

const API_URL = "/api/messages";

const DEFAULT_PROFILE = { hasChildren: true, hasStroller: true, hasSeniors: false };

const HISTORY_KEY = "hikeagent-history";

function profileIcons({ hasChildren, hasStroller, hasSeniors }) {
  return [hasChildren && "👧", hasStroller && "🚼", hasSeniors && "👴"].filter(Boolean).join("");
}

function groupDesc({ hasChildren, hasStroller, hasSeniors }) {
  if (hasStroller) return hasChildren ? "rodinu s kočíkom" : "turistov s kočíkom";
  if (hasChildren && hasSeniors) return "rodinu s deťmi a seniormi";
  if (hasChildren) return "rodinu s deťmi";
  if (hasSeniors) return "seniorov";
  return "turistov";
}

function buildSystemPrompt(profile) {
  const { hasChildren, hasStroller, hasSeniors } = profile;
  const desc = groupDesc(profile);
  const lines = [];

  lines.push("SKLADBA SKUPINY:");
  if (hasStroller) {
    lines.push("- Malé dieťa v KOČÍKU alebo VOZÍČKU — KRITICKÉ: výlučne spevnený povrch (asfalt alebo hrubý štrk), šírka chodníka min. 1,5 m, sklon max. 8 %, žiadne schody, schodíky ani úzke priechody");
  } else if (hasChildren) {
    lines.push("- Deti idú pešo — trasy musia byť krátke, bezpečné, s nenáročným terénom a zaujímavými zastávkami");
  }
  if (hasSeniors) {
    lines.push("- Seniori v skupine — preferovať mierny terén, kratšie trasy s dostatkom lavičiek a oddychových bodov");
  }

  return `Si špecializovaný agent pre hľadanie turistických trás, náučných chodníkov a prírodných vychádzok. Tvoja úloha je nájsť ideálne trasy pre: ${desc}.

${lines.join("\n")}

LIMIT VYHĽADÁVANÍ: Použi MAXIMÁLNE 10 web_search volaní celkovo. Buď efektívny — kombinuj viac otázok do jedného dotazu.

1. Vyhľadaj turistické chodníky, náučné trasy a vycházkové okruhy v zadanej lokalite (2–3 vyhľadávania)
2. Hľadaj trasy vhodné pre skupinu — prioritou sú spevnené chodníky, náučné okruhy, parky, prírodné rezervácie${hasStroller ? "\n3. PRE KOČÍK: overuj výlučne povrch (asfalt/spevnená cesta), šírku (min. 1,5 m) a sklon (max. 8 %)" : ""}
${hasStroller ? "4" : "3"}. Over trasy na hiking.sk, hiking.dennikn.sk, mapy.cz (turistický mód), turistika.sk, komoot.com a openstreetmap (max 3–4 vyhľadávania)
${hasStroller ? "5" : "4"}. KRITICKY zhodnoť každú trasu:
   - Typ povrchu a prechodnosť${hasStroller ? " pre kočík (spevnený = výborný, štrk = podmienečne, lesný chodník = nevhodný)" : ""}
   - Náročnosť: dĺžka, prevýšenie, čas chôdze${hasChildren ? "\n   - Vhodnosť a bezpečnosť pre deti" : ""}${hasSeniors ? "\n   - Dostupnosť lavičiek, oddychových miest, toaliet" : ""}
   - Zaujímavosť trasy (príroda, história, výhľady, zábava pre deti)
${hasStroller ? "6" : "5"}. Vyhľadaj POI: ihriská, vyhliadky, hrady, reštaurácie, oddychové miesta (1–2 vyhľadávania)
${hasStroller ? "7" : "6"}. Odporuč TOP 3–5 trás
${hasStroller ? "8" : "7"}. Pre každú trasu uveď presné GPS súradnice štartu (startLat, startLng) a centrum oblasti (centerLat, centerLng)
${hasStroller ? "9" : "8"}. Odpovedaj výlučne po slovensky

DÔLEŽITÉ: Odpoveď vráť VÝLUČNE ako čistý JSON objekt bez akýchkoľvek markdown backticks ani vysvetlení:
{
  "summary": "Krátky prehľad turistických možností v danej lokalite (2-3 vety)",
  "centerLat": 48.736,
  "centerLng": 19.146,
  "routes": [
    {
      "name": "Názov trasy",
      "distance": "X km",
      "walkingTime": "X hod Y min",
      "terrain": "Asfalt / Spevnená cesta / Lesný chodník / Zmiešaný",
      "difficulty": "Ľahká / Stredná / Ťažká",
      "elevation": "X m prevýšenia",
      "highlights": "Čo je zaujímavé na trase",${hasStroller ? '\n      "strollerFriendly": "Áno / Čiastočne / Nie — dôvod",' : ""}${hasChildren ? '\n      "childFriendlyScore": 8,' : ""}
      "footwearTip": "Odporúčaná obuv (napr. trekingová obuv / pohodlná obuv / gumáky)",
      "startLat": 48.736,
      "startLng": 19.146,
      "sources": ["https://...", "https://..."],
      "warnings": "Prípadné upozornenia alebo null",
      "recommendation": "Prečo túto trasu odporúčam pre ${desc}",
      "pointsOfInterest": [
        {
          "name": "Názov zaujímavosti",
          "type": "hrad / ihrisko / kúpalisko / reštaurácia / príroda / múzeum / rozhľadňa",
          "distance": "X km od trasy",
          "description": "Krátky popis"
        }
      ]
    }
  ],
  "generalTips": "Všeobecné tipy pre ${desc} v tejto oblasti"
}`;
}

// ─── Hlavný komponent ────────────────────────────────────────────────────────
export default function HikeAgent() {
  const [location, setLocation] = useState("");
  const [phase,    setPhase]    = useState("idle");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [profile,  setProfile]  = useState(DEFAULT_PROFILE);
  const [usage,    setUsage]    = useState(null);
  const [filters,  setFilters]  = useState({ difficulty: [], minScore: 0, strollerOnly: false });
  const [activeTab, setActiveTab] = useState(0);
  const [history,  setHistory]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const [gpsLoading, setGpsLoading] = useState(false);

  const toggleProfile = key => setProfile(p => {
    const next = { ...p, [key]: !p[key] };
    if (!next.hasChildren) next.hasStroller = false;
    return next;
  });

  const resetFilters = () => { setFilters({ difficulty: [], minScore: 0, strollerOnly: false }); setActiveTab(0); };

  const getLocation = async () => {
    if (!navigator.geolocation) {
      setError("Tvoj prehliadač nepodporuje geolokáciu."); setPhase("error"); return;
    }
    setGpsLoading(true);
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=sk`,
        { headers: { "User-Agent": "potulky.kozliatko.sk" } }
      );
      if (!res.ok) throw new Error("Nominatim nedostupný");
      const data = await res.json();
      const place =
        data.address?.city    ||
        data.address?.town    ||
        data.address?.village ||
        data.address?.hamlet  ||
        data.address?.county  ||
        data.display_name?.split(",")[0];
      if (place) setLocation(place);
    } catch (err) {
      const msg =
        err.code === 1 ? "Prístup k polohe bol zamietnutý." :
        err.code === 2 ? "Poloha nie je dostupná." :
        err.code === 3 ? "Vypršal čas na zistenie polohy." :
        `Nepodarilo sa zistiť polohu: ${err.message}`;
      setError(msg); setPhase("error");
    } finally {
      setGpsLoading(false);
    }
  };

  const toggleDifficulty = d => setFilters(f => ({
    ...f,
    difficulty: f.difficulty.includes(d) ? f.difficulty.filter(x => x !== d) : [...f.difficulty, d],
  }));

  const filteredRoutes = (result?.routes || []).filter(r => {
    if (filters.difficulty.length > 0 && !filters.difficulty.includes(r.difficulty)) return false;
    if (profile.hasChildren && filters.minScore > 0 && (r.childFriendlyScore || 0) < filters.minScore) return false;
    if (profile.hasStroller && filters.strollerOnly && !r.strollerFriendly?.startsWith("Áno")) return false;
    return true;
  });

  const phases     = ["Hľadám trasy", "Overujem zdroje", "Hodnotím vhodnosť"];
  const phaseIndex = phase === "searching" ? 0 : phase === "verifying" ? 1 : phase === "analyzing" ? 2 : -1;
  const isLoading  = phaseIndex >= 0;

  const runAgent = async () => {
    if (!location.trim() || isLoading) return;
    setPhase("searching"); setResult(null); setError(null); setUsage(null);

    try {
      const t1 = setTimeout(() => setPhase("verifying"),  5000);
      const t2 = setTimeout(() => setPhase("analyzing"),  11000);

      const headers = { "Content-Type": "application/json" };
      if (import.meta.env.VITE_API_SECRET_TOKEN) {
        headers["x-api-token"] = import.meta.env.VITE_API_SECRET_TOKEN;
      }

      const desc = groupDesc(profile);

      const response = await fetch(API_URL, {
        method:  "POST",
        headers,
        body: JSON.stringify({
          max_tokens: 8000,
          system:     buildSystemPrompt(profile),
          messages:   [{
            role:    "user",
            content: `Nájdi turistické trasy a vychádzky pre ${desc} v okolí: ${location}. Nezabudni na GPS súradnice každej trasy a centrum oblasti.`,
          }],
        }),
      });

      clearTimeout(t1); clearTimeout(t2);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data    = await response.json();
      const text    = data.content.filter(b => b.type === "text").map(b => b.text).join("");
      const jsonStr = extractFirstJSON(text);
      if (!jsonStr) {
        console.error("[HikeAgent] Raw AI response (no JSON found):", text);
        throw new Error("Agent nevrátil správny formát odpovede.");
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonrepair(jsonStr));
      } catch (repairErr) {
        console.error("[HikeAgent] Raw AI response:", text);
        throw new Error(`Chyba spracovania JSON: ${repairErr.message}`);
      }
      const usageData = data.usage || null;

      setResult(parsed);
      setUsage(usageData);
      setActiveTab(0);
      resetFilters();

      const entry = { id: Date.now(), location, profile: { ...profile }, result: parsed, usage: usageData, cost: calcCost(usageData) };
      setHistory(prev => {
        const deduped = prev.filter(h => !(h.location === location && JSON.stringify(h.profile) === JSON.stringify(profile)));
        const next    = [entry, ...deduped].slice(0, 10);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
        return next;
      });

      setPhase("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setPhase("error");
    }
  };

  const scoreColor = s => s >= 8 ? "#059669" : s >= 6 ? "#d97706" : "#dc2626";
  const diffColor  = d => d === "Ľahká" ? "#059669" : d === "Stredná" ? "#d97706" : "#dc2626";

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(150deg, #fefce8 0%, #fef9c3 50%, #fefce8 100%)", fontFamily: "system-ui, -apple-system, sans-serif", color: "#422006", padding: "1.5rem 1rem" }}>

      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: "2rem", animation: "fadeUp 0.5s ease" }}>
        <div style={{ fontSize: "2.6rem", marginBottom: "0.5rem" }}>🥾</div>
        <h1 style={{ margin: "0 0 0.3rem", fontSize: "clamp(1.7rem, 5vw, 2.5rem)", fontWeight: "700", letterSpacing: "-0.01em", background: "linear-gradient(120deg, #92400e 20%, #d97706 80%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          HikeAgent
        </h1>
        <p style={{ margin: 0, color: "#78716c", fontSize: "0.9rem" }}>
          Turistické trasy na mieru · Mapa · Predpoveď počasia
        </p>
      </header>

      {/* Profil skupiny */}
      <div style={{ maxWidth: "640px", margin: "0 auto 1.4rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", animation: "fadeUp 0.5s ease 0.05s both" }}>
        {[
          { key: "hasChildren", label: "👨‍👩‍👧 Deti",       depends: null },
          { key: "hasStroller", label: "🚼 Kočík/vozík", depends: "hasChildren" },
          { key: "hasSeniors",  label: "👴 Seniori",     depends: null },
        ].map(({ key, label, depends }) => {
          const disabled = depends && !profile[depends];
          const active   = !disabled && profile[key];
          return (
            <button
              key={key}
              onClick={() => !disabled && toggleProfile(key)}
              title={disabled ? "Najprv zapni Deti" : undefined}
              style={{
                padding: "0.45rem 1.1rem", borderRadius: "20px", border: "1.5px solid",
                borderColor: disabled ? "#e5e7eb" : active ? "#d97706" : "#fde68a",
                background:  disabled ? "#f9fafb" : active ? "#fef3c7" : "#fff",
                color:       disabled ? "#d1d5db" : active ? "#92400e" : "#78716c",
                fontSize: "0.85rem", cursor: disabled ? "default" : "pointer",
                fontFamily: "inherit", fontWeight: active ? "600" : "normal",
                transition: "all 0.15s", boxShadow: active ? "0 1px 4px rgba(217,119,6,0.2)" : "none",
              }}
            >
              {active && !disabled ? "✓ " : ""}{label}
            </button>
          );
        })}
      </div>

      {/* História */}
      {history.length > 0 && (
        <div style={{ maxWidth: "640px", margin: "0 auto 1rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.72rem", color: "#9ca3af", whiteSpace: "nowrap" }}>Nedávne:</span>
            {history.map(h => (
              <button
                key={h.id}
                onClick={() => { setLocation(h.location); setProfile(h.profile); setResult(h.result); setUsage(h.usage); resetFilters(); setPhase("done"); }}
                title={`${h.location} · ${new Date(h.id).toLocaleDateString("sk")}`}
                style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid #e5e7eb", background: "#fff", color: "#92400e", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", display: "flex", gap: "0.3rem", alignItems: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
              >
                <span>{h.location}</span>
                <span style={{ opacity: 0.6, fontSize: "0.7rem" }}>{profileIcons(h.profile)}</span>
              </button>
            ))}
            <button
              onClick={() => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} }}
              style={{ padding: "0.2rem 0.55rem", borderRadius: "20px", border: "1px solid #fee2e2", background: "transparent", color: "#fca5a5", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}
              title="Vymazať históriu"
            >🗑️</button>
          </div>
        </div>
      )}

      {/* Hľadanie */}
      <div className="search-row" style={{ maxWidth: "640px", margin: "0 auto 2rem", display: "flex", gap: "0.6rem", animation: "fadeUp 0.5s ease 0.1s both" }}>
        <input
          value={location}
          onChange={e => setLocation(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runAgent()}
          placeholder="Zadaj lokalitu, napr. Banská Štiavnica"
          disabled={isLoading}
          style={{ flex: 1, padding: "0.85rem 1.1rem", borderRadius: "12px", border: "1.5px solid #fde68a", background: "#fff", color: "#422006", fontSize: "1rem", transition: "border-color 0.15s, box-shadow 0.15s", fontFamily: "inherit", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        />
        <button
          onClick={getLocation}
          disabled={isLoading || gpsLoading}
          title="Použiť moju GPS polohu"
          style={{ padding: "0.85rem 0.95rem", borderRadius: "12px", border: "1.5px solid #fde68a", background: "#fff", color: gpsLoading ? "#9ca3af" : "#d97706", fontSize: "1.1rem", cursor: isLoading || gpsLoading ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
        >
          {gpsLoading ? "⏳" : "📍"}
        </button>
        <button
          className="search-btn"
          onClick={runAgent}
          disabled={isLoading || !location.trim()}
          style={{ padding: "0.85rem 1.5rem", borderRadius: "12px", border: "none", background: isLoading ? "#e5e7eb" : "linear-gradient(135deg, #f59e0b, #d97706)", color: isLoading ? "#9ca3af" : "#fff", fontWeight: "600", fontSize: "0.95rem", cursor: isLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: isLoading ? "none" : "0 2px 8px rgba(217,119,6,0.35)" }}
        >
          {isLoading ? "⏳ Pracujem…" : "🔍 Hľadaj"}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: "center", marginBottom: "2.5rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "1.1rem", background: "#fff", border: "1px solid #fde68a", borderRadius: "18px", padding: "1.8rem 2.5rem", boxShadow: "0 4px 20px rgba(217,119,6,0.12)" }}>
            <div style={{ width: "34px", height: "34px", border: "3px solid #fde68a", borderTopColor: "#d97706", borderRadius: "50%", animation: "spin 0.85s linear infinite" }} />
            <p style={{ margin: 0, color: "#92400e", animation: "pulse 2s infinite", fontWeight: "500" }}>{phases[phaseIndex]}…</p>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
              {phases.map((step, i) => (
                <div key={step} style={{ padding: "0.25rem 0.75rem", borderRadius: "20px", fontSize: "0.77rem", background: i <= phaseIndex ? "#fef3c7" : "#f9fafb", border: `1px solid ${i <= phaseIndex ? "#fde68a" : "#e5e7eb"}`, color: i <= phaseIndex ? "#92400e" : "#9ca3af", transition: "all 0.35s" }}>
                  {i < phaseIndex ? "✓" : i === phaseIndex ? "▶" : "○"} {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chyba */}
      {phase === "error" && (
        <div style={{ maxWidth: "640px", margin: "0 auto 2rem", padding: "1rem 1.3rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", color: "#dc2626" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Výsledky */}
      {result && (
        <div style={{ maxWidth: "900px", margin: "0 auto", animation: "fadeUp 0.45s ease" }}>

          {/* Súhrn */}
          <div style={{ background: "#fff", border: "1px solid #fde68a", borderLeft: "4px solid #d97706", borderRadius: "12px", padding: "1rem 1.3rem", marginBottom: "1.3rem", boxShadow: "0 1px 4px rgba(217,119,6,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
              <p style={{ margin: 0, color: "#374151", lineHeight: 1.65, fontSize: "0.93rem" }}>
                📍 <strong style={{ color: "#422006" }}>{location}</strong> — {result.summary}
              </p>
              {usage && (
                <div
                  style={{ flexShrink: 0, padding: "0.2rem 0.7rem", borderRadius: "20px", background: "#fffbeb", border: "1px solid #fde68a", fontSize: "0.75rem", color: "#92400e", whiteSpace: "nowrap" }}
                  title={`Vstup: ${usage.inputTokens?.toLocaleString()} tokenov · Výstup: ${usage.outputTokens?.toLocaleString()} tokenov · Vyhľadávania: ${usage.searchCount}`}
                >
                  💰 ~${calcCost(usage)?.toFixed(3)} · {usage.searchCount} 🔍
                </div>
              )}
            </div>
          </div>

          {/* Filter */}
          {(result.routes?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center", marginBottom: "1.1rem", padding: "0.65rem 0.9rem", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px" }}>
              <span style={{ fontSize: "0.74rem", color: "#9ca3af" }}>Filtre:</span>
              {["Ľahká", "Stredná", "Ťažká"].map(d => (
                <button key={d} onClick={() => toggleDifficulty(d)} style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid", borderColor: filters.difficulty.includes(d) ? diffColor(d) : "#e5e7eb", background: filters.difficulty.includes(d) ? `${diffColor(d)}12` : "transparent", color: filters.difficulty.includes(d) ? diffColor(d) : "#6b7280", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", fontWeight: filters.difficulty.includes(d) ? "600" : "normal" }}>
                  {d}
                </button>
              ))}
              {profile.hasChildren && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem", color: "#6b7280", cursor: "pointer" }}>
                  <input type="range" min={0} max={10} value={filters.minScore} onChange={e => setFilters(f => ({ ...f, minScore: +e.target.value }))}
                    style={{ width: "70px", accentColor: "#d97706" }} />
                  👶 min {filters.minScore}/10
                </label>
              )}
              {profile.hasStroller && (
                <button onClick={() => setFilters(f => ({ ...f, strollerOnly: !f.strollerOnly }))} style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid", borderColor: filters.strollerOnly ? "#d97706" : "#e5e7eb", background: filters.strollerOnly ? "#fef3c7" : "transparent", color: filters.strollerOnly ? "#92400e" : "#6b7280", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", fontWeight: filters.strollerOnly ? "600" : "normal" }}>
                  🚼 Len kočík OK
                </button>
              )}
              {(filters.difficulty.length > 0 || filters.minScore > 0 || filters.strollerOnly) && (
                <button onClick={resetFilters} style={{ padding: "0.2rem 0.55rem", borderRadius: "20px", border: "1px solid #e5e7eb", background: "transparent", color: "#9ca3af", fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}>✕ Reset</button>
              )}
              <span style={{ marginLeft: "auto", fontSize: "0.74rem", color: "#9ca3af" }}>
                {filteredRoutes.length}/{result.routes.length} trás
              </span>
            </div>
          )}

          {result.centerLat && result.centerLng && (
            <RouteMap routes={result.routes || []} centerLat={result.centerLat} centerLng={result.centerLng} location={location} />
          )}

          {/* Taby */}
          {filteredRoutes.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#9ca3af", fontStyle: "italic", marginBottom: "2rem" }}>
              Žiadne trasy nevyhovujú aktívnym filtrom.
            </div>
          ) : (() => {
            const tabIdx = Math.min(activeTab, filteredRoutes.length - 1);
            const route  = filteredRoutes[tabIdx];
            const color  = ROUTE_COLORS[tabIdx % ROUTE_COLORS.length];
            return (
              <div style={{ marginBottom: "2rem" }}>
                <div
                  className="tab-header"
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", padding: "0.5rem 0.5rem 0", background: "#f9fafb", borderRadius: "14px 14px 0 0", border: "1px solid #e5e7eb", borderBottom: "none" }}
                >
                  {filteredRoutes.map((r, i) => {
                    const c      = ROUTE_COLORS[i % ROUTE_COLORS.length];
                    const active = i === tabIdx;
                    return (
                      <button
                        key={i}
                        className="tab-btn"
                        onClick={() => setActiveTab(i)}
                        style={{
                          flex: "1 1 auto", minWidth: "120px", maxWidth: "260px",
                          padding: "0.5rem 0.85rem 0.65rem",
                          border: `1.5px solid ${active ? c : "#e5e7eb"}`,
                          borderBottom: active ? `1.5px solid ${color}20` : "1.5px solid #e5e7eb",
                          borderRadius: "10px 10px 0 0",
                          background: active ? `linear-gradient(180deg, ${c}18 0%, ${c}08 100%)` : "#fff",
                          color: active ? c : "#6b7280",
                          fontSize: "0.83rem", cursor: "pointer",
                          fontFamily: "inherit", transition: "all 0.15s",
                          fontWeight: active ? "700" : "normal",
                          boxShadow: active ? `0 -2px 6px ${c}18` : "none",
                          marginBottom: active ? "-1.5px" : "0",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}
                      >
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: "1.25rem", height: "1.25rem", borderRadius: "50%",
                          background: active ? c : "#e5e7eb",
                          color: active ? "#fff" : "#6b7280",
                          fontSize: "0.7rem", fontWeight: "bold",
                          marginRight: "0.4rem", flexShrink: 0,
                        }}>{i + 1}</span>
                        {r.name.length > 22 ? r.name.slice(0, 21) + "…" : r.name}
                      </button>
                    );
                  })}
                </div>

                <div style={{ background: "#fff", border: `1.5px solid ${color}55`, borderTop: `3px solid ${color}`, borderRadius: "0 0 16px 16px", padding: "1.3rem 1.4rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.85rem" }}>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#422006", fontWeight: "700" }}>
                      <span style={{ color, marginRight: "0.4rem" }}>{tabIdx + 1}.</span>{route.name}
                    </h3>
                    {profile.hasChildren && route.childFriendlyScore != null && (
                      <div style={{ padding: "0.2rem 0.8rem", borderRadius: "20px", background: `${scoreColor(route.childFriendlyScore)}12`, border: `1px solid ${scoreColor(route.childFriendlyScore)}44`, fontSize: "0.82rem", color: scoreColor(route.childFriendlyScore), fontWeight: "600" }}>
                        👶 {route.childFriendlyScore}/10
                      </div>
                    )}
                  </div>

                  <div className="route-badges" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.85rem" }}>
                    {[
                      { icon: "📏", val: route.distance },
                      route.walkingTime && { icon: "⏱️", val: route.walkingTime },
                      { icon: "🛤️", val: route.terrain },
                      { icon: "⛰️", val: route.elevation },
                    ].filter(Boolean).map(t => (
                      <span key={t.val} style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: "#fefce8", border: "1px solid #fde68a", fontSize: "0.82rem", color: "#374151" }}>{t.icon} {t.val}</span>
                    ))}
                    <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: `${diffColor(route.difficulty)}10`, border: `1px solid ${diffColor(route.difficulty)}44`, fontSize: "0.82rem", color: diffColor(route.difficulty), fontWeight: "600" }}>💪 {route.difficulty}</span>
                    {route.footwearTip && (
                      <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: "#f5f3ff", border: "1px solid #ddd6fe", fontSize: "0.82rem", color: "#7c3aed" }}>
                        🥾 {route.footwearTip}
                      </span>
                    )}
                  </div>

                  {profile.hasStroller && route.strollerFriendly && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.9rem", borderRadius: "10px", marginBottom: "0.8rem", background: route.strollerFriendly.startsWith("Áno") ? "#ecfdf5" : route.strollerFriendly.startsWith("Čias") ? "#fffbeb" : "#fef2f2", border: `1px solid ${route.strollerFriendly.startsWith("Áno") ? "#a7f3d0" : route.strollerFriendly.startsWith("Čias") ? "#fde68a" : "#fecaca"}`, fontSize: "0.82rem", color: route.strollerFriendly.startsWith("Áno") ? "#059669" : route.strollerFriendly.startsWith("Čias") ? "#d97706" : "#dc2626", fontWeight: "500" }}>
                      🚼 Kočík/vozík: {route.strollerFriendly}
                    </div>
                  )}

                  <p style={{ margin: "0 0 0.5rem", color: "#374151", fontSize: "0.88rem", lineHeight: 1.65 }}>✨ {route.highlights}</p>
                  <p style={{ margin: "0 0 0.5rem", color: "#92400e", fontSize: "0.88rem", fontStyle: "italic", lineHeight: 1.5 }}>💡 {route.recommendation}</p>
                  {route.warnings && route.warnings !== "null" && <p style={{ margin: "0 0 0.5rem", color: "#d97706", fontSize: "0.83rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "0.4rem 0.7rem" }}>⚠️ {route.warnings}</p>}

                  <WeatherForecast lat={route.startLat} lng={route.startLng} />

                  {route.pointsOfInterest?.length > 0 && (
                    <div style={{ marginTop: "1rem", borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                      <p style={{ margin: "0 0 0.55rem", fontSize: "0.78rem", color: "#92400e", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600" }}>🏛️ Zaujímavosti do 10 km</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        {route.pointsOfInterest.map((poi, j) => (
                          <div key={j} style={{ display: "flex", gap: "0.65rem", padding: "0.5rem 0.75rem", borderRadius: "10px", background: "#f9fafb", border: "1px solid #e5e7eb" }}>
                            <span style={{ fontSize: "1.05rem", flexShrink: 0 }}>{POI_ICONS[poi.type] || "📍"}</span>
                            <div>
                              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: "0.84rem", color: "#422006", fontWeight: "600" }}>{poi.name}</span>
                                <span style={{ fontSize: "0.74rem", color: "#9ca3af" }}>{poi.distance}</span>
                              </div>
                              <p style={{ margin: 0, fontSize: "0.79rem", color: "#6b7280", lineHeight: 1.5 }}>{poi.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.85rem", borderTop: "1px solid #e5e7eb", paddingTop: "0.7rem", alignItems: "center" }}>
                    {route.startLat && route.startLng && (
                      <a href={`https://mapy.cz/turisticka?x=${route.startLng}&y=${route.startLat}&z=15&source=coor&id=${route.startLng},${route.startLat}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: "#fff7ed", border: "1px solid #fed7aa", fontSize: "0.8rem", color: "#ea580c", textDecoration: "none", fontWeight: "500" }}>
                        🗺️ Otvoriť v Mapy.cz
                      </a>
                    )}
                    {(() => {
                      const isValid = v => typeof v === "number" && isFinite(v);
                      const lat = isValid(route.startLat) ? route.startLat : result.centerLat;
                      const lng = isValid(route.startLng) ? route.startLng : result.centerLng;
                      const base = `https://www.komoot.com/discover/${encodeURIComponent(location)}/`;
                      const href = isValid(lat) && isValid(lng)
                        ? `${base}@${lat},${lng}/tours?sport=hiking`
                        : `${base}tours?sport=hiking`;
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: "#fefce8", border: "1px solid #fde68a", fontSize: "0.8rem", color: "#92400e", textDecoration: "none", fontWeight: "500" }}>
                          🟤 Hľadať na Komoot
                        </a>
                      );
                    })()}
                    {route.sources?.length > 0 && (
                      <>
                        <span style={{ fontSize: "0.74rem", color: "#9ca3af" }}>Zdroje:</span>
                        {route.sources.map(src => {
                          const raw = src.startsWith("http") ? src : `https://${src}`;
                          let href = null, label = src;
                          try {
                            const u = new URL(raw);
                            if (u.hostname.includes(".") && !u.hostname.includes(" ")) {
                              href = raw;
                              label = u.hostname.replace(/^www\./, "");
                            }
                          } catch {}
                          const shared = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: "#fef3c7", border: "1px solid #fde68a", fontSize: "0.8rem", fontWeight: "500" };
                          return href
                            ? <a key={src} href={href} target="_blank" rel="noopener noreferrer" style={{ ...shared, color: "#92400e", textDecoration: "none", cursor: "pointer" }}>🔗 {label}</a>
                            : <span key={src} style={{ ...shared, color: "#78350f" }}>📄 {src}</span>;
                        })}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {result.generalTips && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "14px", padding: "1.1rem 1.4rem", marginBottom: "2rem" }}>
              <h4 style={{ margin: "0 0 0.45rem", color: "#92400e", fontWeight: "600", fontSize: "0.93rem" }}>
                🌿 Tipy pre {groupDesc(profile)}
              </h4>
              <p style={{ margin: 0, color: "#78350f", lineHeight: 1.65, fontSize: "0.88rem" }}>{result.generalTips}</p>
            </div>
          )}

          <div style={{ textAlign: "center" }}>
            <button onClick={() => { setPhase("idle"); setResult(null); setLocation(""); }} style={{ padding: "0.6rem 1.4rem", borderRadius: "10px", border: "1px solid #fde68a", background: "#fff", color: "#92400e", fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              🔄 Nové hľadanie
            </button>
          </div>
        </div>
      )}

      {phase === "idle" && !result && (
        <div style={{ textAlign: "center", color: "#9ca3af", marginTop: "3rem", fontSize: "0.9rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.35 }}>🗺️</div>
          Zadaj lokalitu — agent nájde turistické trasy, zobrazí ich na mape<br />a pridá predpoveď počasia na 3 dni.
        </div>
      )}
    </div>
  );
}
