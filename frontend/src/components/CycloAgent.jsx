import { useState, useEffect, useRef } from "react";
import { jsonrepair } from "jsonrepair";
import { weatherInfo } from "../utils.js";

// ─── Konfigurácia ────────────────────────────────────────────────────────────
// V dev režime Vite proxy presmeruje /api → backend:3001
// V produkcii nginx proxy presmeruje /api → backend:3001
const API_URL = "/api/messages";

const SYSTEM_PROMPT = `Si špecialistový agent pre hľadanie rodinných cyklociest. Tvoja úloha je:

SKLADBA SKUPINY:
- Dospelí jazdia na ELEKTROBICIYKLOCH (e-bike) — zvládnu väčšie prevýšenie a dlhšie trasy bez únavy
- Jedno dieťa ide na vlastnom detskom bicykli — trasa musí byť bezpečná a zvládnuteľná aj pre dieťa samostatne
- Druhé dieťa je v cyklovozíku ALEBO v cyklosedačke — pozor na: šírku chodníka (min. 1,5m pre vozík), povrch bez výmoľov, ostré zákruty, schodíky, rampy

LIMIT VYHĽADÁVANÍ: Použi MAXIMÁLNE 8 web_search volaní celkovo. Buď efektívny — kombinuj viac otázok do jedného dotazu.

1. Vyhľadaj cyklotrasy v zadanej lokalite pomocou web_search nástroja (1-2 vyhľadávania)
2. Hľadaj VÝLUČNE asfaltové alebo spevnené povrchy (nie terénne trail trasy)
3. Over trasy z dostupných zdrojov (mapy.cz, cycling.sk, openstreetmap — max 2-3 ďalšie vyhľadávania)
4. KRITICKY zhodnoť každú trasu:
   - Bezpečnosť (intenzita premávky, cyklopruhy, oddelenie od áut)
   - Vhodnosť pre cyklovozík/sedačku (šírka, povrch, prechodnosť)
   - Náročnosť pre dieťa na vlastnom bicykli (prevýšenie, sklon)
   - Povrch (asfalt = výborný, spevnená cesta = dobrý, makadám = akceptovateľný)
   - Dĺžka (reálna pre deti: 5–30 km; e-bike rodičia zvládnu aj dlhšie)
5. Vyhľadaj zaujímavosti do 10 km od trás (1-2 vyhľadávania — kombinuj viaceré trasy do jedného dotazu)
6. Odporuč TOP 3–5 trás
7. Pre každú trasu uveď presné GPS súradnice štartu (startLat, startLng) a celkové centrum oblasti (centerLat, centerLng)

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
      "highlights": "Čo je zaujímavé na trase",
      "trailerFriendly": "Áno / Čiastočne / Nie — dôvod",
      "childFriendlyScore": 8,
      "startLat": 48.736,
      "startLng": 19.146,
      "sources": ["zdroj1", "zdroj2"],
      "warnings": "Prípadné upozornenia alebo null",
      "recommendation": "Prečo túto trasu odporúčam pre e-bike rodinu s deťmi",
      "pointsOfInterest": [
        {
          "name": "Názov zaujímavosti",
          "type": "hrad / ihrisko / kúpalisko / reštaurácia / príroda / múzeum / rozhľadňa",
          "distance": "X km od trasy",
          "description": "Krátky popis prečo je vhodné pre rodinu"
        }
      ]
    }
  ],
  "generalTips": "Všeobecné tipy pre e-bike rodinu s deťmi a cyklovozíkom v tejto oblasti"
}`;

// ─── Pomocné konštanty ───────────────────────────────────────────────────────
const ROUTE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa"];
const DAY_NAMES    = ["Dnes", "Zajtra", "Pozajtra"];
const POI_ICONS    = { hrad: "🏰", ihrisko: "🛝", kúpalisko: "🏊", reštaurácia: "🍽️", príroda: "🌿", múzeum: "🏛️", rozhľadňa: "🔭" };

// ─── Mapa ────────────────────────────────────────────────────────────────────
function RouteMap({ routes, centerLat, centerLng }) {
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

      routes.forEach((route, i) => {
        if (!route.startLat || !route.startLng) return;
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const icon  = L.divIcon({
          className: "",
          html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#000;font-weight:bold;font-size:14px;transform:rotate(-45deg);box-shadow:0 2px 10px rgba(0,0,0,0.5)"><span style="transform:rotate(45deg)">${i + 1}</span></div>`,
          iconSize:    [34, 34],
          iconAnchor:  [17, 34],
          popupAnchor: [0, -36],
        });
        L.marker([route.startLat, route.startLng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:Georgia,serif;min-width:190px;color:#ddeee3">
              <strong style="color:${color}">${i + 1}. ${route.name}</strong><br/>
              📏 ${route.distance} &nbsp; ⛰️ ${route.elevation}<br/>
              🛣️ ${route.surface} &nbsp; 💪 ${route.difficulty}
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
    <div style={{ marginBottom: "1.8rem", borderRadius: "18px", overflow: "hidden", border: "1px solid #1e4d2b" }}>
      <div style={{ padding: "0.6rem 1rem", background: "rgba(34,197,94,0.07)", borderBottom: "1px solid #1e4d2b", fontSize: "0.78rem", color: "#5a9a6a", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        🗺️ Mapa trás — klikni na marker pre detail
      </div>
      <div ref={mapRef} style={{ height: "340px", width: "100%", background: "#0f2d1b" }} />
      <div style={{ padding: "0.55rem 1rem", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
        {routes.map((r, i) => (
          <span key={i} style={{ fontSize: "0.77rem", padding: "0.2rem 0.65rem", borderRadius: "6px", background: `${ROUTE_COLORS[i % ROUTE_COLORS.length]}18`, border: `1px solid ${ROUTE_COLORS[i % ROUTE_COLORS.length]}55`, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }}>
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

  if (loading) return <div style={{ fontSize: "0.78rem", color: "#3d6b4a", fontStyle: "italic", padding: "0.4rem 0" }}>Načítavam počasie...</div>;
  if (!weather) return null;

  return (
    <div style={{ marginTop: "0.85rem", borderTop: "1px solid #1a3d26", paddingTop: "0.85rem" }}>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "#5a9a6a", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        🌤️ Predpoveď počasia — 3 dni
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {weather.time?.map((_, i) => {
          const info = weatherInfo(weather.weathercode[i]);
          const rain = weather.precipitation_sum[i];
          return (
            <div key={i} style={{ flex: 1, padding: "0.55rem 0.4rem", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid #172e1f", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#5a9a6a", marginBottom: "0.2rem" }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: "1.35rem", lineHeight: 1.2 }}>{info.icon}</div>
              <div style={{ fontSize: "0.68rem", color: "#7ab88a", margin: "0.15rem 0" }}>{info.label}</div>
              <div style={{ fontSize: "0.83rem", color: "#fde68a", fontWeight: "bold" }}>
                {Math.round(weather.temperature_2m_max[i])}° <span style={{ color: "#5a9a6a", fontWeight: "normal" }}>/ {Math.round(weather.temperature_2m_min[i])}°</span>
              </div>
              {rain > 0 && <div style={{ fontSize: "0.67rem", color: "#60a5fa", marginTop: "0.1rem" }}>💧 {rain.toFixed(1)} mm</div>}
              <div style={{ fontSize: "0.67rem", color: "#3d6b4a" }}>💨 {Math.round(weather.windspeed_10m_max[i])} km/h</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hlavný komponent ────────────────────────────────────────────────────────
export default function CycloAgent() {
  const [location, setLocation] = useState("");
  const [phase,    setPhase]    = useState("idle");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);

  const phases     = ["Hľadám trasy", "Overujem zdroje", "Hodnotím vhodnosť"];
  const phaseIndex = phase === "searching" ? 0 : phase === "verifying" ? 1 : phase === "analyzing" ? 2 : -1;
  const isLoading  = phaseIndex >= 0;

  const runAgent = async () => {
    if (!location.trim() || isLoading) return;
    setPhase("searching"); setResult(null); setError(null);

    try {
      const t1 = setTimeout(() => setPhase("verifying"),  5000);
      const t2 = setTimeout(() => setPhase("analyzing"),  11000);

      const headers = { "Content-Type": "application/json" };
      if (import.meta.env.VITE_API_SECRET_TOKEN) {
        headers["x-api-token"] = import.meta.env.VITE_API_SECRET_TOKEN;
      }

      const response = await fetch(API_URL, {
        method:  "POST",
        headers,
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system:     SYSTEM_PROMPT,
          tools:      [{ type: "web_search_20250305", name: "web_search" }],
          messages:   [{
            role:    "user",
            content: `Nájdi rodinné cyklotrasy pre e-bike rodinu s deťmi v okolí: ${location}. Nezabudni na GPS súradnice každej trasy a centrum oblasti.`,
          }],
        }),
      });

      clearTimeout(t1); clearTimeout(t2);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
      const m    = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Agent nevrátil správny formát odpovede.");

      setResult(JSON.parse(jsonrepair(m[0])));
      setPhase("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setPhase("error");
    }
  };

  const scoreColor = s => s >= 8 ? "#4ade80" : s >= 6 ? "#facc15" : "#f87171";
  const diffColor  = d => d === "Ľahká" ? "#4ade80" : d === "Stredná" ? "#facc15" : "#f87171";

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #071a0f 0%, #0f2d1b 40%, #071a0f 100%)", fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", color: "#ddeee3", padding: "2rem 1.5rem" }}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        input::placeholder { color: #3d6b4a; }
        input:focus        { border-color: #4ade80 !important; outline: none; }
        .route-card:hover  { border-color: #3d7a4d !important; }
        .leaflet-popup-content-wrapper { background: #0f2d1b !important; color: #ddeee3 !important; border: 1px solid #2a5a35 !important; border-radius: 12px !important; }
        .leaflet-popup-tip             { background: #0f2d1b !important; }
        .leaflet-popup-content         { margin: 10px 14px !important; }
      `}</style>

      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: "2.5rem", animation: "fadeUp 0.6s ease" }}>
        <div style={{ fontSize: "2.8rem", marginBottom: "0.6rem", filter: "drop-shadow(0 0 20px #22c55e66)" }}>🚴‍♀️</div>
        <h1 style={{ margin: "0 0 0.35rem", fontSize: "clamp(1.8rem, 5vw, 2.8rem)", fontWeight: "normal", letterSpacing: "0.08em", background: "linear-gradient(100deg, #86efac 30%, #fde68a 80%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          CycloAgent
        </h1>
        <p style={{ margin: 0, color: "#5a9a6a", fontStyle: "italic", fontSize: "0.9rem" }}>
          Rodinné cyklotrasy · E-bike · Mapa · Predpoveď počasia
        </p>
      </header>

      {/* Hľadanie */}
      <div style={{ maxWidth: "620px", margin: "0 auto 2.5rem", display: "flex", gap: "0.75rem", animation: "fadeUp 0.6s ease 0.1s both" }}>
        <input
          value={location}
          onChange={e => setLocation(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runAgent()}
          placeholder="Zadaj lokalitu, napr. Banská Bystrica"
          disabled={isLoading}
          style={{ flex: 1, padding: "0.9rem 1.2rem", borderRadius: "14px", border: "1.5px solid #1e4d2b", background: "rgba(255,255,255,0.05)", color: "#ddeee3", fontSize: "1rem", transition: "border-color 0.2s", fontFamily: "inherit" }}
        />
        <button onClick={runAgent} disabled={isLoading || !location.trim()} style={{ padding: "0.9rem 1.6rem", borderRadius: "14px", border: "none", background: isLoading ? "rgba(34,197,94,0.15)" : "linear-gradient(135deg, #22c55e, #16a34a)", color: isLoading ? "#4ade80" : "#fff", fontWeight: "bold", fontSize: "0.95rem", cursor: isLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          {isLoading ? "⏳ Pracujem..." : "🔍 Hľadaj"}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: "center", marginBottom: "2.5rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "1.2rem", background: "rgba(34,197,94,0.06)", border: "1px solid #1e4d2b", borderRadius: "20px", padding: "2rem 3rem" }}>
            <div style={{ width: "36px", height: "36px", border: "3px solid #16a34a", borderTopColor: "#86efac", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
            <p style={{ margin: 0, color: "#86efac", fontStyle: "italic", animation: "pulse 2s infinite" }}>{phases[phaseIndex]}...</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {phases.map((step, i) => (
                <div key={step} style={{ padding: "0.3rem 0.8rem", borderRadius: "20px", fontSize: "0.78rem", fontFamily: "monospace", background: i <= phaseIndex ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${i <= phaseIndex ? "#22c55e" : "#1e4d2b"}`, color: i <= phaseIndex ? "#86efac" : "#3d6b4a", transition: "all 0.4s" }}>
                  {i < phaseIndex ? "✓" : i === phaseIndex ? "▶" : "○"} {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chyba */}
      {phase === "error" && (
        <div style={{ maxWidth: "620px", margin: "0 auto 2rem", padding: "1rem 1.4rem", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "14px", color: "#fca5a5" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Výsledky */}
      {result && (
        <div style={{ maxWidth: "900px", margin: "0 auto", animation: "fadeUp 0.5s ease" }}>

          <div style={{ background: "rgba(34,197,94,0.07)", border: "1px solid #1e4d2b", borderLeft: "4px solid #22c55e", borderRadius: "14px", padding: "1rem 1.4rem", marginBottom: "1.5rem" }}>
            <p style={{ margin: 0, color: "#a7d9b2", lineHeight: 1.65, fontSize: "0.94rem" }}>
              📍 <strong style={{ color: "#86efac" }}>{location}</strong> — {result.summary}
            </p>
          </div>

          {result.centerLat && result.centerLng && (
            <RouteMap routes={result.routes || []} centerLat={result.centerLat} centerLng={result.centerLng} />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "1.3rem", marginBottom: "2rem" }}>
            {result.routes?.map((route, i) => (
              <div key={i} className="route-card" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e4d2b", borderLeft: `4px solid ${ROUTE_COLORS[i % ROUTE_COLORS.length]}`, borderRadius: "18px", padding: "1.4rem 1.6rem", transition: "border-color 0.2s" }}>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#fde68a", fontWeight: "normal" }}>
                    <span style={{ color: ROUTE_COLORS[i % ROUTE_COLORS.length], marginRight: "0.5rem", fontFamily: "monospace" }}>{i + 1}.</span>{route.name}
                  </h3>
                  <div style={{ padding: "0.25rem 0.85rem", borderRadius: "20px", background: `${scoreColor(route.childFriendlyScore)}18`, border: `1px solid ${scoreColor(route.childFriendlyScore)}55`, fontSize: "0.82rem", color: scoreColor(route.childFriendlyScore), fontFamily: "monospace" }}>
                    👶 {route.childFriendlyScore}/10
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.9rem" }}>
                  {[{ icon: "📏", val: route.distance }, { icon: "🛣️", val: route.surface }, { icon: "⛰️", val: route.elevation }].map(t => (
                    <span key={t.val} style={{ padding: "0.25rem 0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid #1e4d2b", fontSize: "0.82rem", color: "#9ec9aa" }}>{t.icon} {t.val}</span>
                  ))}
                  <span style={{ padding: "0.25rem 0.75rem", borderRadius: "8px", background: `${diffColor(route.difficulty)}12`, border: `1px solid ${diffColor(route.difficulty)}44`, fontSize: "0.82rem", color: diffColor(route.difficulty) }}>💪 {route.difficulty}</span>
                  <span style={{ padding: "0.25rem 0.75rem", borderRadius: "8px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.35)", fontSize: "0.82rem", color: "#c4b5fd" }}>⚡ E-bike</span>
                </div>

                {route.trailerFriendly && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.9rem", borderRadius: "10px", marginBottom: "0.8rem", background: route.trailerFriendly.startsWith("Áno") ? "rgba(74,222,128,0.1)" : route.trailerFriendly.startsWith("Čias") ? "rgba(251,191,36,0.1)" : "rgba(248,113,113,0.1)", border: `1px solid ${route.trailerFriendly.startsWith("Áno") ? "rgba(74,222,128,0.35)" : route.trailerFriendly.startsWith("Čias") ? "rgba(251,191,36,0.35)" : "rgba(248,113,113,0.35)"}`, fontSize: "0.82rem", color: route.trailerFriendly.startsWith("Áno") ? "#4ade80" : route.trailerFriendly.startsWith("Čias") ? "#fbbf24" : "#f87171" }}>
                    🛻 Cyklovozík / sedačka: {route.trailerFriendly}
                  </div>
                )}

                <p style={{ margin: "0 0 0.5rem", color: "#b8d9bf", fontSize: "0.88rem", lineHeight: 1.6 }}>✨ {route.highlights}</p>
                <p style={{ margin: "0 0 0.5rem", color: "#86efac", fontSize: "0.88rem", fontStyle: "italic", lineHeight: 1.5 }}>💡 {route.recommendation}</p>
                {route.warnings && route.warnings !== "null" && <p style={{ margin: "0 0 0.5rem", color: "#fbbf24", fontSize: "0.83rem" }}>⚠️ {route.warnings}</p>}

                <WeatherForecast lat={route.startLat} lng={route.startLng} />

                {route.pointsOfInterest?.length > 0 && (
                  <div style={{ marginTop: "1rem", borderTop: "1px solid #1a3d26", paddingTop: "1rem" }}>
                    <p style={{ margin: "0 0 0.55rem", fontSize: "0.78rem", color: "#5a9a6a", letterSpacing: "0.06em", textTransform: "uppercase" }}>🏛️ Zaujímavosti do 10 km</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {route.pointsOfInterest.map((poi, j) => (
                        <div key={j} style={{ display: "flex", gap: "0.7rem", padding: "0.5rem 0.75rem", borderRadius: "10px", background: "rgba(255,255,255,0.025)", border: "1px solid #172e1f" }}>
                          <span style={{ fontSize: "1rem", flexShrink: 0 }}>{POI_ICONS[poi.type] || "📍"}</span>
                          <div>
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontSize: "0.84rem", color: "#fde68a" }}>{poi.name}</span>
                              <span style={{ fontSize: "0.74rem", color: "#3d6b4a" }}>{poi.distance}</span>
                            </div>
                            <p style={{ margin: 0, fontSize: "0.79rem", color: "#7ab88a", lineHeight: 1.5 }}>{poi.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {route.sources?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.8rem", borderTop: "1px solid #1a3d26", paddingTop: "0.7rem" }}>
                    <span style={{ fontSize: "0.74rem", color: "#3d6b4a", alignSelf: "center" }}>Zdroje:</span>
                    {route.sources.map(src => (
                      <span key={src} style={{ padding: "0.15rem 0.6rem", borderRadius: "6px", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", fontSize: "0.74rem", color: "#a5b4fc" }}>🔗 {src}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.generalTips && (
            <div style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: "16px", padding: "1.2rem 1.5rem", marginBottom: "2rem" }}>
              <h4 style={{ margin: "0 0 0.5rem", color: "#fde68a", fontWeight: "normal", fontSize: "0.95rem" }}>🌿 Tipy pre e-bike rodinu s deťmi</h4>
              <p style={{ margin: 0, color: "#9ec9aa", lineHeight: 1.65, fontSize: "0.88rem" }}>{result.generalTips}</p>
            </div>
          )}

          <div style={{ textAlign: "center" }}>
            <button onClick={() => { setPhase("idle"); setResult(null); setLocation(""); }} style={{ padding: "0.65rem 1.5rem", borderRadius: "10px", border: "1px solid #1e4d2b", background: "transparent", color: "#5a9a6a", fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              🔄 Nové hľadanie
            </button>
          </div>
        </div>
      )}

      {phase === "idle" && !result && (
        <div style={{ textAlign: "center", color: "#2d5a3a", marginTop: "3rem", fontSize: "0.9rem", fontStyle: "italic" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.4 }}>🗺️</div>
          Zadaj lokalitu — agent nájde trasy, zobrazí ich na mape<br />a pridá predpoveď počasia na 3 dni.
        </div>
      )}
    </div>
  );
}
