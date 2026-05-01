import { useState, useEffect, useRef } from "react";
import { jsonrepair } from "jsonrepair";
import { weatherInfo } from "../utils.js";

// ─── Konfigurácia ────────────────────────────────────────────────────────────
// V dev režime Vite proxy presmeruje /api → backend:3001
// V produkcii nginx proxy presmeruje /api → backend:3001
const API_URL = "/api/messages";

const DEFAULT_PROFILE = { hasEbike: true, hasChildren: true, hasTrailer: true };

const HISTORY_KEY = "bikeagent-history";
// DeepSeek V3 ceny (USD/token)
const PRICE_INPUT  = 0.27  / 1_000_000;
const PRICE_OUTPUT = 1.10  / 1_000_000;
const PRICE_SEARCH = 0.01; // Tavily / vyhľadávanie

function calcCost(usage) {
  if (!usage) return null;
  return usage.inputTokens * PRICE_INPUT + usage.outputTokens * PRICE_OUTPUT + usage.searchCount * PRICE_SEARCH;
}

function profileIcons({ hasEbike, hasChildren, hasTrailer }) {
  return [hasEbike && "⚡", hasChildren && "👧", hasTrailer && "🛻"].filter(Boolean).join("");
}

function buildSystemPrompt({ hasEbike, hasChildren, hasTrailer }) {
  const lines = [];

  // Skladba skupiny
  lines.push("SKLADBA SKUPINY:");
  lines.push(`- Dospelí jazdia na ${hasEbike ? "ELEKTROBICIYKLOCH (e-bike) — zvládnu väčšie prevýšenie a dlhšie trasy bez únavy" : "bežných bicykloch — treba dbať na prevýšenie a celkovú náročnosť trasy"}`);
  if (hasChildren && hasTrailer) {
    lines.push("- Jedno dieťa ide na vlastnom detskom bicykli — trasa musí byť bezpečná a zvládnuteľná aj pre dieťa samostatne");
    lines.push("- Druhé dieťa je v PRÍVESNOM VOZÍKU — kritické požiadavky: šírka chodníka min. 1,5 m, hladký povrch bez výmoľov, žiadne ostré zákruty, schodíky ani rampy");
  } else if (hasChildren) {
    lines.push("- Deti idú na vlastných detských bicykloch — trasy musia byť bezpečné, s miernym sklonom a zvládnuteľné pre deti");
  }

  const groupDesc = !hasChildren
    ? "cyklistov"
    : hasTrailer
    ? "e-bike rodinu s deťmi a prívesným vozíkom"
    : hasEbike
    ? "e-bike rodinu s deťmi"
    : "rodinu s deťmi";

  // Pokyny pre agenta
  const prompt = `Si špecializovaný agent pre hľadanie cyklociest. Tvoja úloha je nájsť ideálne trasy pre: ${groupDesc}.

${lines.join("\n")}

LIMIT VYHĽADÁVANÍ: Použi MAXIMÁLNE 10 web_search volaní celkovo. Buď efektívny — kombinuj viac otázok do jedného dotazu.

1. Vyhľadaj cyklotrasy v zadanej lokalite pomocou web_search nástroja (2-3 vyhľadávania)
2. Hľadaj VÝLUČNE asfaltové alebo spevnené povrchy (nie terénne trail trasy)
3. Over trasy z dostupných zdrojov (mapy.cz, hiking.sk, cycling.sk, openstreetmap — max 3-4 ďalšie vyhľadávania)
4. KRITICKY zhodnoť každú trasu:
   - Bezpečnosť (intenzita premávky, cyklopruhy, oddelenie od áut)${hasTrailer ? "\n   - Vhodnosť pre prívesný vozík (šírka min. 1,5m, povrch, prechodnosť)" : ""}${hasChildren ? "\n   - Náročnosť pre deti na bicykli (prevýšenie, sklon)" : ""}
   - Povrch (asfalt = výborný, spevnená cesta = dobrý, makadám = akceptovateľný)
   - Dĺžka (${hasChildren ? "reálna pre deti: 5–30 km" : "5–60 km"}; ${hasEbike ? "e-bike zvládne aj dlhšie trasy" : "zohľadni fyzickú náročnosť"})
   - Preferuj dedikované trasy bez áut
5. Vyhľadaj zaujímavosti do 10 km od trás (1-2 vyhľadávania — kombinuj viaceré trasy do jedného dotazu)
6. Odporuč TOP 3–5 trás
7. Pre každú trasu uveď presné GPS súradnice štartu (startLat, startLng) a celkové centrum oblasti (centerLat, centerLng)
8. Odpovedaj výlučne po slovensky

DÔLEŽITÉ: Odpoveď vráť VÝLUČNE ako čistý JSON objekt bez akýchkoľvek markdown backticks ani vysvetlení:
{
  "summary": "Krátky prehľad cyklomožností v danej lokalite (2-3 vety)",
  "centerLat": 48.736,
  "centerLng": 19.146,
  "routes": [
    {
      "name": "Názov trasy",
      "distance": "X km",
      "surface": "Asfalt / Spevnená cesta / Zmiešaný",
      "difficulty": "Ľahká / Stredná / Ťažká",
      "elevation": "X m prevýšenia",
      "highlights": "Čo je zaujímavé na trase",${hasTrailer ? '\n      "trailerFriendly": "Áno / Čiastočne / Nie — dôvod",' : ""}${hasChildren ? '\n      "childFriendlyScore": 8,' : ""}
      "startLat": 48.736,
      "startLng": 19.146,
      "sources": ["zdroj1", "zdroj2"],
      "warnings": "Prípadné upozornenia alebo null",
      "recommendation": "Prečo túto trasu odporúčam pre ${groupDesc}",
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
  "generalTips": "Všeobecné tipy pre ${groupDesc} v tejto oblasti"
}`;
  return prompt;
}

// Extrahuje prvý kompletný JSON objekt zo stringu (ignoruje text za ním)
function extractFirstJSON(str) {
  const start = str.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc)              { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"')        { inStr = !inStr; continue; }
    if (inStr)            continue;
    if (c === '{')        depth++;
    if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null;
}

// ─── Pomocné konštanty ───────────────────────────────────────────────────────
const ROUTE_COLORS = ["#059669", "#2563eb", "#db2777", "#ea580c", "#7c3aed"];
const DAY_NAMES    = ["Dnes", "Zajtra", "Pozajtra"];
const POI_ICONS    = { hrad: "🏰", ihrisko: "🛝", kúpalisko: "🏊", reštaurácia: "🍽️", príroda: "🌿", múzeum: "🏛️", rozhľadňa: "🔭" };

// ─── Mapa ────────────────────────────────────────────────────────────────────
function RouteMap({ routes, centerLat, centerLng, location }) {
  const mapRef     = useRef(null);
  const leafletMap = useRef(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    const load = async () => {
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id   = "leaflet-css";
        link.rel  = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
        document.head.appendChild(link);
      }
      if (!window.L) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src     = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
          s.onload  = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      const L   = window.L;
      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false });
      leafletMap.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      map.setView([centerLat, centerLng], 11);

      // Marker pre centrum vyhľadávanej lokality
      const centerIcon = L.divIcon({
        className: "",
        html: `<div style="width:38px;height:38px;border-radius:50%;background:#f59e0b;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(245,158,11,0.5);font-size:17px">📍</div>`,
        iconSize:    [38, 38],
        iconAnchor:  [19, 19],
        popupAnchor: [0, -22],
      });
      L.marker([centerLat, centerLng], { icon: centerIcon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:system-ui,sans-serif;color:#064e3b;min-width:140px">
            <strong>📍 ${location || "Vyhľadávaná lokalita"}</strong><br/>
            <span style="font-size:0.8em;color:#9ca3af">centrum oblasti</span>
          </div>`
        );

      routes.forEach((route, i) => {
        const isApprox = route.startLat == null || route.startLng == null;
        const lat = isApprox ? centerLat : route.startLat;
        const lng = isApprox ? centerLng : route.startLng;
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const icon  = L.divIcon({
          className: "",
          html: isApprox
            ? `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:${color};border:2px dashed #fff;opacity:0.65;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:13px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.18)"><span style="transform:rotate(45deg)">~${i + 1}</span></div>`
            : `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;transform:rotate(-45deg);box-shadow:0 2px 10px rgba(0,0,0,0.25)"><span style="transform:rotate(45deg)">${i + 1}</span></div>`,
          iconSize:    [34, 34],
          iconAnchor:  [17, 34],
          popupAnchor: [0, -36],
        });
        L.marker([lat, lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:system-ui,sans-serif;min-width:190px;color:#064e3b">
              <strong style="color:${color}">${i + 1}. ${route.name}</strong><br/>
              📏 ${route.distance} &nbsp; ⛰️ ${route.elevation}<br/>
              🛣️ ${route.surface} &nbsp; 💪 ${route.difficulty}
              ${isApprox ? '<br/><em style="color:#9ca3af;font-size:0.8em">📍 poloha orientačná</em>' : ''}
            </div>`
          );
      });
    };

    load().catch(console.error);
    return () => {
      if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
    };
  }, []);

  return (
    <div style={{ marginBottom: "1.5rem", borderRadius: "14px", overflow: "hidden", border: "1px solid #d1fae5", boxShadow: "0 1px 8px rgba(5,150,105,0.08)" }}>
      <div style={{ padding: "0.55rem 1rem", background: "#f0fdf4", borderBottom: "1px solid #d1fae5", fontSize: "0.75rem", color: "#059669", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600" }}>
        🗺️ Mapa trás — klikni na marker pre detail
      </div>
      <div ref={mapRef} style={{ height: "320px", width: "100%" }} />
      <div style={{ padding: "0.5rem 1rem", background: "#fff", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {routes.map((r, i) => (
          <span key={i} style={{ fontSize: "0.75rem", padding: "0.18rem 0.6rem", borderRadius: "6px", background: `${ROUTE_COLORS[i % ROUTE_COLORS.length]}15`, border: `1px solid ${ROUTE_COLORS[i % ROUTE_COLORS.length]}55`, color: ROUTE_COLORS[i % ROUTE_COLORS.length], fontWeight: "500" }}>
            {i + 1}. {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Počasie ─────────────────────────────────────────────────────────────────
function WeatherForecast({ lat, lng }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lat || !lng) { setLoading(false); return; }
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=auto&forecast_days=3`)
      .then(r => r.json())
      .then(d => { setWeather(d.daily); setLoading(false); })
      .catch(() => setLoading(false));
  }, [lat, lng]);

  if (loading) return <div style={{ fontSize: "0.78rem", color: "#6b7280", fontStyle: "italic", padding: "0.4rem 0" }}>Načítavam počasie...</div>;
  if (!weather) return null;

  return (
    <div style={{ marginTop: "0.85rem", borderTop: "1px solid #e5e7eb", paddingTop: "0.85rem" }}>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "#047857", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: "600" }}>
        🌤️ Predpoveď počasia — 3 dni
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {weather.time?.map((_, i) => {
          const info = weatherInfo(weather.weathercode[i]);
          const rain = weather.precipitation_sum[i];
          return (
            <div key={i} style={{ flex: 1, padding: "0.6rem 0.4rem", borderRadius: "10px", background: "#f0fdf4", border: "1px solid #d1fae5", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: "0.2rem" }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: "1.35rem", lineHeight: 1.2 }}>{info.icon}</div>
              <div style={{ fontSize: "0.68rem", color: "#047857", margin: "0.15rem 0" }}>{info.label}</div>
              <div style={{ fontSize: "0.83rem", color: "#064e3b", fontWeight: "600" }}>
                {Math.round(weather.temperature_2m_max[i])}° <span style={{ color: "#9ca3af", fontWeight: "normal" }}>/ {Math.round(weather.temperature_2m_min[i])}°</span>
              </div>
              {rain > 0 && <div style={{ fontSize: "0.67rem", color: "#2563eb", marginTop: "0.1rem" }}>💧 {rain.toFixed(1)} mm</div>}
              <div style={{ fontSize: "0.67rem", color: "#9ca3af" }}>💨 {Math.round(weather.windspeed_10m_max[i])} km/h</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hlavný komponent ────────────────────────────────────────────────────────
export default function BikeAgent() {
  const [location, setLocation] = useState("");
  const [phase,    setPhase]    = useState("idle");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [profile,  setProfile]  = useState(DEFAULT_PROFILE);
  const [usage,    setUsage]    = useState(null);
  const [filters,  setFilters]  = useState({ difficulty: [], minScore: 0, trailerOnly: false });
  const [activeTab, setActiveTab] = useState(0);
  const [history,  setHistory]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });

  const toggleProfile = key => setProfile(p => {
    const next = { ...p, [key]: !p[key] };
    if (!next.hasChildren) next.hasTrailer = false;
    return next;
  });

  const resetFilters = () => { setFilters({ difficulty: [], minScore: 0, trailerOnly: false }); setActiveTab(0); };

  const toggleDifficulty = d => setFilters(f => ({
    ...f,
    difficulty: f.difficulty.includes(d) ? f.difficulty.filter(x => x !== d) : [...f.difficulty, d],
  }));

  const filteredRoutes = (result?.routes || []).filter(r => {
    if (filters.difficulty.length > 0 && !filters.difficulty.includes(r.difficulty)) return false;
    if (profile.hasChildren && filters.minScore > 0 && (r.childFriendlyScore || 0) < filters.minScore) return false;
    if (profile.hasTrailer && filters.trailerOnly && !r.trailerFriendly?.startsWith("Áno")) return false;
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

      const groupDesc = !profile.hasChildren
        ? "cyklistov"
        : profile.hasTrailer
        ? "e-bike rodinu s deťmi a prívesným vozíkom"
        : profile.hasEbike
        ? "e-bike rodinu s deťmi"
        : "rodinu s deťmi";

      const response = await fetch(API_URL, {
        method:  "POST",
        headers,
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system:     buildSystemPrompt(profile),
          tools:      [{ type: "web_search_20250305", name: "web_search" }],
          messages:   [{
            role:    "user",
            content: `Nájdi cyklotrasy pre ${groupDesc} v okolí: ${location}. Nezabudni na GPS súradnice každej trasy a centrum oblasti.`,
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
        console.error("[BikeAgent] Raw AI response (no JSON found):", text);
        throw new Error("Agent nevrátil správny formát odpovede.");
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonrepair(jsonStr));
      } catch (repairErr) {
        console.error("[BikeAgent] Raw AI response:", text);
        throw new Error(`Chyba spracovania JSON: ${repairErr.message}`);
      }
      const usageData = data.usage || null;

      setResult(parsed);
      setUsage(usageData);
      setActiveTab(0);
      resetFilters();

      // Uloženie do histórie
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

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(150deg, #f0fdf4 0%, #ecfdf5 50%, #f0fdf4 100%)", fontFamily: "system-ui, -apple-system, sans-serif", color: "#064e3b", padding: "1.5rem 1rem" }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:0.55; } }
        input::placeholder { color: #9ca3af; }
        input:focus        { border-color: #059669 !important; outline: none; box-shadow: 0 0 0 3px rgba(5,150,105,0.12) !important; }
        button:hover:not(:disabled) { opacity: 0.88; }
        .leaflet-popup-content-wrapper { background: #fff !important; color: #064e3b !important; border: 1px solid #d1fae5 !important; border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.1) !important; }
        .leaflet-popup-tip             { background: #fff !important; }
        .leaflet-popup-content         { margin: 10px 14px !important; }
        @media (max-width: 540px) {
          .search-row { flex-direction: column !important; }
          .search-btn { width: 100% !important; }
          .tab-header { flex-wrap: wrap !important; }
          .tab-btn    { flex: 1 1 calc(50% - 0.3rem) !important; min-width: 130px !important; }
          .route-badges { gap: 0.35rem !important; }
          .poi-row { flex-direction: column !important; }
        }
        @media (max-width: 380px) {
          .tab-btn { flex: 1 1 100% !important; border-radius: 8px !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: "2rem", animation: "fadeUp 0.5s ease" }}>
        <div style={{ fontSize: "2.6rem", marginBottom: "0.5rem" }}>🚴‍♀️</div>
        <h1 style={{ margin: "0 0 0.3rem", fontSize: "clamp(1.7rem, 5vw, 2.5rem)", fontWeight: "700", letterSpacing: "-0.01em", background: "linear-gradient(120deg, #059669 20%, #0284c7 80%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          BikeAgent
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>
          Cyklotrasy na mieru · Mapa · Predpoveď počasia
        </p>
      </header>

      {/* Profil skupiny */}
      <div style={{ maxWidth: "640px", margin: "0 auto 1.4rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", animation: "fadeUp 0.5s ease 0.05s both" }}>
        {[
          { key: "hasEbike",    label: "⚡ E-bike",         depends: null },
          { key: "hasChildren", label: "👨‍👩‍👧 Deti",            depends: null },
          { key: "hasTrailer",  label: "🛻 Prívesný vozík", depends: "hasChildren" },
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
                borderColor: disabled ? "#e5e7eb" : active ? "#059669" : "#d1fae5",
                background:  disabled ? "#f9fafb" : active ? "#ecfdf5" : "#fff",
                color:       disabled ? "#d1d5db" : active ? "#059669" : "#6b7280",
                fontSize: "0.85rem", cursor: disabled ? "default" : "pointer",
                fontFamily: "inherit", fontWeight: active ? "600" : "normal",
                transition: "all 0.15s", boxShadow: active ? "0 1px 4px rgba(5,150,105,0.15)" : "none",
              }}
            >
              {active && !disabled ? "✓ " : ""}{label}
            </button>
          );
        })}
      </div>

      {/* História vyhľadávaní */}
      {history.length > 0 && (
        <div style={{ maxWidth: "640px", margin: "0 auto 1rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.72rem", color: "#9ca3af", whiteSpace: "nowrap" }}>Nedávne:</span>
            {history.map(h => (
              <button
                key={h.id}
                onClick={() => { setLocation(h.location); setProfile(h.profile); setResult(h.result); setUsage(h.usage); resetFilters(); setPhase("done"); }}
                title={`${h.location} · ${new Date(h.id).toLocaleDateString("sk")}`}
                style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid #e5e7eb", background: "#fff", color: "#047857", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", display: "flex", gap: "0.3rem", alignItems: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
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
          placeholder="Zadaj lokalitu, napr. Banská Bystrica"
          disabled={isLoading}
          style={{ flex: 1, padding: "0.85rem 1.1rem", borderRadius: "12px", border: "1.5px solid #d1fae5", background: "#fff", color: "#064e3b", fontSize: "1rem", transition: "border-color 0.15s, box-shadow 0.15s", fontFamily: "inherit", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        />
        <button
          className="search-btn"
          onClick={runAgent}
          disabled={isLoading || !location.trim()}
          style={{ padding: "0.85rem 1.5rem", borderRadius: "12px", border: "none", background: isLoading ? "#e5e7eb" : "linear-gradient(135deg, #10b981, #059669)", color: isLoading ? "#9ca3af" : "#fff", fontWeight: "600", fontSize: "0.95rem", cursor: isLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: isLoading ? "none" : "0 2px 8px rgba(5,150,105,0.3)" }}
        >
          {isLoading ? "⏳ Pracujem…" : "🔍 Hľadaj"}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: "center", marginBottom: "2.5rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "1.1rem", background: "#fff", border: "1px solid #d1fae5", borderRadius: "18px", padding: "1.8rem 2.5rem", boxShadow: "0 4px 20px rgba(5,150,105,0.1)" }}>
            <div style={{ width: "34px", height: "34px", border: "3px solid #d1fae5", borderTopColor: "#059669", borderRadius: "50%", animation: "spin 0.85s linear infinite" }} />
            <p style={{ margin: 0, color: "#047857", animation: "pulse 2s infinite", fontWeight: "500" }}>{phases[phaseIndex]}…</p>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
              {phases.map((step, i) => (
                <div key={step} style={{ padding: "0.25rem 0.75rem", borderRadius: "20px", fontSize: "0.77rem", background: i <= phaseIndex ? "#ecfdf5" : "#f9fafb", border: `1px solid ${i <= phaseIndex ? "#a7f3d0" : "#e5e7eb"}`, color: i <= phaseIndex ? "#059669" : "#9ca3af", transition: "all 0.35s" }}>
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
          <div style={{ background: "#fff", border: "1px solid #d1fae5", borderLeft: "4px solid #059669", borderRadius: "12px", padding: "1rem 1.3rem", marginBottom: "1.3rem", boxShadow: "0 1px 4px rgba(5,150,105,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
              <p style={{ margin: 0, color: "#374151", lineHeight: 1.65, fontSize: "0.93rem" }}>
                📍 <strong style={{ color: "#064e3b" }}>{location}</strong> — {result.summary}
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
                    style={{ width: "70px", accentColor: "#059669" }} />
                  👶 min {filters.minScore}/10
                </label>
              )}
              {profile.hasTrailer && (
                <button onClick={() => setFilters(f => ({ ...f, trailerOnly: !f.trailerOnly }))} style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid", borderColor: filters.trailerOnly ? "#059669" : "#e5e7eb", background: filters.trailerOnly ? "#ecfdf5" : "transparent", color: filters.trailerOnly ? "#059669" : "#6b7280", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", fontWeight: filters.trailerOnly ? "600" : "normal" }}>
                  🛻 Len vozík OK
                </button>
              )}
              {(filters.difficulty.length > 0 || filters.minScore > 0 || filters.trailerOnly) && (
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
                {/* Tab hlavičky */}
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

                {/* Obsah tabu */}
                <div style={{ background: "#fff", border: `1.5px solid ${color}55`, borderTop: `3px solid ${color}`, borderRadius: "0 0 16px 16px", padding: "1.3rem 1.4rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.85rem" }}>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#064e3b", fontWeight: "700" }}>
                      <span style={{ color, marginRight: "0.4rem" }}>{tabIdx + 1}.</span>{route.name}
                    </h3>
                    {profile.hasChildren && route.childFriendlyScore != null && (
                      <div style={{ padding: "0.2rem 0.8rem", borderRadius: "20px", background: `${scoreColor(route.childFriendlyScore)}12`, border: `1px solid ${scoreColor(route.childFriendlyScore)}44`, fontSize: "0.82rem", color: scoreColor(route.childFriendlyScore), fontWeight: "600" }}>
                        👶 {route.childFriendlyScore}/10
                      </div>
                    )}
                  </div>

                  <div className="route-badges" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.85rem" }}>
                    {[{ icon: "📏", val: route.distance }, { icon: "🛣️", val: route.surface }, { icon: "⛰️", val: route.elevation }].map(t => (
                      <span key={t.val} style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #d1fae5", fontSize: "0.82rem", color: "#374151" }}>{t.icon} {t.val}</span>
                    ))}
                    <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: `${diffColor(route.difficulty)}10`, border: `1px solid ${diffColor(route.difficulty)}44`, fontSize: "0.82rem", color: diffColor(route.difficulty), fontWeight: "600" }}>💪 {route.difficulty}</span>
                    {profile.hasEbike && <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.82rem", color: "#2563eb" }}>⚡ E-bike</span>}
                  </div>

                  {profile.hasTrailer && route.trailerFriendly && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.9rem", borderRadius: "10px", marginBottom: "0.8rem", background: route.trailerFriendly.startsWith("Áno") ? "#ecfdf5" : route.trailerFriendly.startsWith("Čias") ? "#fffbeb" : "#fef2f2", border: `1px solid ${route.trailerFriendly.startsWith("Áno") ? "#a7f3d0" : route.trailerFriendly.startsWith("Čias") ? "#fde68a" : "#fecaca"}`, fontSize: "0.82rem", color: route.trailerFriendly.startsWith("Áno") ? "#059669" : route.trailerFriendly.startsWith("Čias") ? "#d97706" : "#dc2626", fontWeight: "500" }}>
                      🛻 Prívesný vozík: {route.trailerFriendly}
                    </div>
                  )}

                  <p style={{ margin: "0 0 0.5rem", color: "#374151", fontSize: "0.88rem", lineHeight: 1.65 }}>✨ {route.highlights}</p>
                  <p style={{ margin: "0 0 0.5rem", color: "#059669", fontSize: "0.88rem", fontStyle: "italic", lineHeight: 1.5 }}>💡 {route.recommendation}</p>
                  {route.warnings && route.warnings !== "null" && <p style={{ margin: "0 0 0.5rem", color: "#d97706", fontSize: "0.83rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "0.4rem 0.7rem" }}>⚠️ {route.warnings}</p>}

                  <WeatherForecast lat={route.startLat} lng={route.startLng} />

                  {route.pointsOfInterest?.length > 0 && (
                    <div style={{ marginTop: "1rem", borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                      <p style={{ margin: "0 0 0.55rem", fontSize: "0.78rem", color: "#047857", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600" }}>🏛️ Zaujímavosti do 10 km</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        {route.pointsOfInterest.map((poi, j) => (
                          <div key={j} style={{ display: "flex", gap: "0.65rem", padding: "0.5rem 0.75rem", borderRadius: "10px", background: "#f9fafb", border: "1px solid #e5e7eb" }}>
                            <span style={{ fontSize: "1.05rem", flexShrink: 0 }}>{POI_ICONS[poi.type] || "📍"}</span>
                            <div>
                              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: "0.84rem", color: "#064e3b", fontWeight: "600" }}>{poi.name}</span>
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
                      <a href={`https://mapy.cz/cyklo?x=${route.startLng}&y=${route.startLat}&z=15&source=coor&id=${route.startLng},${route.startLat}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: "#fff7ed", border: "1px solid #fed7aa", fontSize: "0.8rem", color: "#ea580c", textDecoration: "none", fontWeight: "500" }}>
                        🗺️ Otvoriť v Mapy.cz
                      </a>
                    )}
                    {route.sources?.length > 0 && (
                      <>
                        <span style={{ fontSize: "0.74rem", color: "#9ca3af" }}>Zdroje:</span>
                        {route.sources.map(src => (
                          <span key={src} style={{ padding: "0.15rem 0.6rem", borderRadius: "6px", background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.74rem", color: "#2563eb" }}>🔗 {src}</span>
                        ))}
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
                🌿 Tipy pre {!profile.hasChildren ? "cyklistov" : profile.hasTrailer ? "e-bike rodinu s prívesným vozíkom" : profile.hasEbike ? "e-bike rodinu s deťmi" : "rodinu s deťmi"}
              </h4>
              <p style={{ margin: 0, color: "#78350f", lineHeight: 1.65, fontSize: "0.88rem" }}>{result.generalTips}</p>
            </div>
          )}

          <div style={{ textAlign: "center" }}>
            <button onClick={() => { setPhase("idle"); setResult(null); setLocation(""); }} style={{ padding: "0.6rem 1.4rem", borderRadius: "10px", border: "1px solid #d1fae5", background: "#fff", color: "#047857", fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              🔄 Nové hľadanie
            </button>
          </div>
        </div>
      )}

      {phase === "idle" && !result && (
        <div style={{ textAlign: "center", color: "#9ca3af", marginTop: "3rem", fontSize: "0.9rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.35 }}>🗺️</div>
          Zadaj lokalitu — agent nájde trasy, zobrazí ich na mape<br />a pridá predpoveď počasia na 3 dni.
        </div>
      )}
    </div>
  );
}
