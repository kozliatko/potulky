import { useState, useEffect, useRef } from "react";
import { weatherInfo } from "../utils.js";

export const ROUTE_COLORS = ["#059669", "#2563eb", "#db2777", "#ea580c", "#7c3aed"];
export const DAY_NAMES    = ["Dnes", "Zajtra", "Pozajtra"];
export const POI_ICONS    = { hrad: "🏰", ihrisko: "🛝", kúpalisko: "🏊", reštaurácia: "🍽️", príroda: "🌿", múzeum: "🏛️", rozhľadňa: "🔭" };

const PRICE_INPUT  = 0.27  / 1_000_000;
const PRICE_OUTPUT = 1.10  / 1_000_000;
const PRICE_SEARCH = 0.01;

export function calcCost(usage) {
  if (!usage) return null;
  return usage.inputTokens * PRICE_INPUT + usage.outputTokens * PRICE_OUTPUT + usage.searchCount * PRICE_SEARCH;
}

export function extractFirstJSON(str) {
  const start = str.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc)               { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"')         { inStr = !inStr; continue; }
    if (inStr)             continue;
    if (c === "{")         depth++;
    if (c === "}") { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null;
}

export function GlobalStyles() {
  return (
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
      }
      @media (max-width: 380px) {
        .tab-btn { flex: 1 1 100% !important; border-radius: 8px !important; }
      }
    `}</style>
  );
}

export function RouteMap({ routes, centerLat, centerLng, location }) {
  const mapRef     = useRef(null);
  const leafletMap = useRef(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    const load = async () => {
      if (!document.getElementById("leaflet-css")) {
        const link  = document.createElement("link");
        link.id     = "leaflet-css";
        link.rel    = "stylesheet";
        link.href   = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
        document.head.appendChild(link);
      }
      if (!window.L) {
        await new Promise((res, rej) => {
          const s   = document.createElement("script");
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
        const lat      = isApprox ? centerLat : route.startLat;
        const lng      = isApprox ? centerLng : route.startLng;
        const color    = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const terrain  = route.terrain || route.surface || "—";
        const icon     = L.divIcon({
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
              🛤️ ${terrain} &nbsp; 💪 ${route.difficulty}
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

export function WeatherForecast({ lat, lng }) {
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
