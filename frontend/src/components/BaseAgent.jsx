import { useState } from "react";
import { jsonrepair } from "jsonrepair";
import {
  ROUTE_COLORS, POI_ICONS,
  calcCost, extractFirstJSON,
  RouteMap, WeatherForecast,
} from "./shared.jsx";

const API_URL = "/api/messages";

const scoreColor = s => s >= 8 ? "#059669" : s >= 6 ? "#d97706" : "#dc2626";
const diffColor  = d => d === "Ľahká" ? "#059669" : d === "Stredná" ? "#d97706" : "#dc2626";

// ─── Zdieľaný agent (Bike/Hike) — vizuál a texty prichádzajú cez `config` ───
export default function BaseAgent({ config }) {
  const {
    apiMode, title, icon, subtitle, placeholder, idleRoutesLabel, historyKey,
    defaultProfile, profileButtons, profileIcons, tipsGroupDesc,
    equipment, coreBadges, extraBadge, mapyPath, komootSport, theme,
  } = config;

  const [location, setLocation] = useState("");
  const [phase,    setPhase]    = useState("idle");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [profile,  setProfile]  = useState(defaultProfile);
  const [usage,    setUsage]    = useState(null);
  const [filters,  setFilters]  = useState({ difficulty: [], minScore: 0, [equipment.filterKey]: false });
  const [activeTab, setActiveTab] = useState(0);
  const [history,  setHistory]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(historyKey) || "[]"); } catch { return []; }
  });
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError,   setGpsError]   = useState(null);

  const toggleProfile = key => setProfile(p => {
    const next = { ...p, [key]: !p[key] };
    if (!next[key]) {
      profileButtons.forEach(b => { if (b.depends === key) next[b.key] = false; });
    }
    return next;
  });

  const resetFilters = () => { setFilters({ difficulty: [], minScore: 0, [equipment.filterKey]: false }); setActiveTab(0); };

  const getLocation = async () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("Tvoj prehliadač nepodporuje geolokáciu."); return;
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
      setGpsError(msg);
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
    if (profile[equipment.profileKey] && filters[equipment.filterKey] && !r[equipment.routeField]?.startsWith("Áno")) return false;
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

      const response = await fetch(API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: apiMode, profile, location }),
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
        console.error(`[${title}] Raw AI response (no JSON found):`, text);
        throw new Error("Agent nevrátil správny formát odpovede.");
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonrepair(jsonStr));
      } catch (repairErr) {
        console.error(`[${title}] Raw AI response:`, text);
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
        try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch {}
        return next;
      });

      setPhase("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setPhase("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bgGradient, fontFamily: "system-ui, -apple-system, sans-serif", color: theme.textColor, padding: "1.5rem 1rem" }}>

      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: "2rem", animation: "fadeUp 0.5s ease" }}>
        <div style={{ fontSize: "2.6rem", marginBottom: "0.5rem" }}>{icon}</div>
        <h1 style={{ margin: "0 0 0.3rem", fontSize: "clamp(1.7rem, 5vw, 2.5rem)", fontWeight: "700", letterSpacing: "-0.01em", background: theme.titleGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {title}
        </h1>
        <p style={{ margin: 0, color: theme.mutedTextColor, fontSize: "0.9rem" }}>
          {subtitle}
        </p>
      </header>

      {/* Profil skupiny */}
      <div style={{ maxWidth: "640px", margin: "0 auto 1.4rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", animation: "fadeUp 0.5s ease 0.05s both" }}>
        {profileButtons.map(({ key, label, depends, desc }) => {
          const disabled = depends && !profile[depends];
          const active   = !disabled && profile[key];
          return (
            <button
              key={key}
              onClick={() => !disabled && toggleProfile(key)}
              title={disabled ? "Najprv zapni Deti" : desc}
              style={{
                padding: "0.45rem 1.1rem", borderRadius: "20px", border: "1.5px solid",
                borderColor: disabled ? "#e5e7eb" : active ? theme.accent : theme.softBorder,
                background:  disabled ? "#f9fafb" : active ? theme.accentBg : "#fff",
                color:       disabled ? "#d1d5db" : active ? theme.accentTextColor : theme.mutedTextColor,
                fontSize: "0.85rem", cursor: disabled ? "default" : "pointer",
                fontFamily: "inherit", fontWeight: active ? "600" : "normal",
                transition: "all 0.15s", boxShadow: active ? `0 1px 4px ${theme.profileBtnShadow}` : "none",
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
                style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid #e5e7eb", background: "#fff", color: theme.accentDark, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", display: "flex", gap: "0.3rem", alignItems: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
              >
                <span>{h.location}</span>
                <span style={{ opacity: 0.6, fontSize: "0.7rem" }}>{profileIcons(h.profile)}</span>
              </button>
            ))}
            <button
              onClick={() => { setHistory([]); try { localStorage.removeItem(historyKey); } catch {} }}
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
          placeholder={placeholder}
          disabled={isLoading}
          style={{ flex: 1, padding: "0.85rem 1.1rem", borderRadius: "12px", border: `1.5px solid ${theme.softBorder}`, background: "#fff", color: theme.textColor, fontSize: "1rem", transition: "border-color 0.15s, box-shadow 0.15s", fontFamily: "inherit", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        />
        <button
          onClick={getLocation}
          disabled={isLoading || gpsLoading}
          title="Použiť moju GPS polohu"
          style={{ padding: "0.85rem 0.95rem", borderRadius: "12px", border: `1.5px solid ${theme.softBorder}`, background: "#fff", color: gpsLoading ? "#9ca3af" : theme.accent, fontSize: "1.1rem", cursor: isLoading || gpsLoading ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
        >
          {gpsLoading ? "⏳" : "📍"}
        </button>
        <button
          className="search-btn"
          onClick={runAgent}
          disabled={isLoading || !location.trim()}
          style={{ padding: "0.85rem 1.5rem", borderRadius: "12px", border: "none", background: isLoading ? "#e5e7eb" : theme.searchGradient, color: isLoading ? "#9ca3af" : "#fff", fontWeight: "600", fontSize: "0.95rem", cursor: isLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: isLoading ? "none" : `0 2px 8px ${theme.searchBtnShadow}` }}
        >
          {isLoading ? "⏳ Pracujem…" : "🔍 Hľadaj"}
        </button>
      </div>

      {/* GPS varovanie */}
      {gpsError && (
        <div style={{ maxWidth: "640px", margin: "-1.4rem auto 1.6rem", padding: "0.55rem 0.9rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", color: "#92400e", fontSize: "0.82rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", animation: "fadeUp 0.3s ease" }}>
          <span>⚠️ {gpsError} Zadaj lokalitu ručne.</span>
          <button onClick={() => setGpsError(null)} title="Zavrieť" style={{ background: "none", border: "none", color: "#92400e", cursor: "pointer", fontSize: "0.95rem", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: "center", marginBottom: "2.5rem", animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "1.1rem", background: "#fff", border: `1px solid ${theme.softBorder}`, borderRadius: "18px", padding: "1.8rem 2.5rem", boxShadow: `0 4px 20px ${theme.loadingBoxShadow}` }}>
            <div style={{ width: "34px", height: "34px", border: `3px solid ${theme.softBorder}`, borderTopColor: theme.accent, borderRadius: "50%", animation: "spin 0.85s linear infinite" }} />
            <p style={{ margin: 0, color: theme.accentDark, animation: "pulse 2s infinite", fontWeight: "500" }}>{phases[phaseIndex]}…</p>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
              {phases.map((step, i) => (
                <div key={step} style={{ padding: "0.25rem 0.75rem", borderRadius: "20px", fontSize: "0.77rem", background: i <= phaseIndex ? theme.accentBg : "#f9fafb", border: `1px solid ${i <= phaseIndex ? theme.phaseActiveBorder : "#e5e7eb"}`, color: i <= phaseIndex ? theme.accentTextColor : "#9ca3af", transition: "all 0.35s" }}>
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
          <div style={{ background: "#fff", border: `1px solid ${theme.softBorder}`, borderLeft: `4px solid ${theme.accent}`, borderRadius: "12px", padding: "1rem 1.3rem", marginBottom: "1.3rem", boxShadow: `0 1px 4px ${theme.summaryShadow}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
              <p style={{ margin: 0, color: "#374151", lineHeight: 1.65, fontSize: "0.93rem" }}>
                📍 <strong style={{ color: theme.textColor }}>{location}</strong> — {result.summary}
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
                    style={{ width: "70px", accentColor: theme.accent }} />
                  👶 min {filters.minScore}/10
                </label>
              )}
              {profile[equipment.profileKey] && (
                <button onClick={() => setFilters(f => ({ ...f, [equipment.filterKey]: !f[equipment.filterKey] }))} style={{ padding: "0.2rem 0.65rem", borderRadius: "20px", border: "1px solid", borderColor: filters[equipment.filterKey] ? theme.accent : "#e5e7eb", background: filters[equipment.filterKey] ? theme.accentBg : "transparent", color: filters[equipment.filterKey] ? theme.accentTextColor : "#6b7280", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", fontWeight: filters[equipment.filterKey] ? "600" : "normal" }}>
                  {equipment.filterLabel}
                </button>
              )}
              {(filters.difficulty.length > 0 || filters.minScore > 0 || filters[equipment.filterKey]) && (
                <button onClick={resetFilters} style={{ padding: "0.2rem 0.55rem", borderRadius: "20px", border: "1px solid #e5e7eb", background: "transparent", color: "#9ca3af", fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}>✕ Reset</button>
              )}
              <span style={{ marginLeft: "auto", fontSize: "0.74rem", color: "#9ca3af" }}>
                {filteredRoutes.length}/{result.routes.length} trás
              </span>
            </div>
          )}

          {result.centerLat && result.centerLng && (
            <RouteMap
              key={`${location}-${result.centerLat}-${result.centerLng}`}
              routes={result.routes || []} centerLat={result.centerLat} centerLng={result.centerLng} location={location}
            />
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
            const extra  = extraBadge(route, profile);
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
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: theme.textColor, fontWeight: "700" }}>
                      <span style={{ color, marginRight: "0.4rem" }}>{tabIdx + 1}.</span>{route.name}
                    </h3>
                    {profile.hasChildren && route.childFriendlyScore != null && (
                      <div style={{ padding: "0.2rem 0.8rem", borderRadius: "20px", background: `${scoreColor(route.childFriendlyScore)}12`, border: `1px solid ${scoreColor(route.childFriendlyScore)}44`, fontSize: "0.82rem", color: scoreColor(route.childFriendlyScore), fontWeight: "600" }}>
                        👶 {route.childFriendlyScore}/10
                      </div>
                    )}
                  </div>

                  <div className="route-badges" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.85rem" }}>
                    {coreBadges(route).map(t => (
                      <span key={t.val} style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: theme.badgeBg, border: `1px solid ${theme.softBorder}`, fontSize: "0.82rem", color: "#374151" }}>{t.icon} {t.val}</span>
                    ))}
                    <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: `${diffColor(route.difficulty)}10`, border: `1px solid ${diffColor(route.difficulty)}44`, fontSize: "0.82rem", color: diffColor(route.difficulty), fontWeight: "600" }}>💪 {route.difficulty}</span>
                    {extra && (
                      <span style={{ padding: "0.22rem 0.7rem", borderRadius: "8px", background: extra.bg, border: `1px solid ${extra.border}`, fontSize: "0.82rem", color: extra.color }}>
                        {extra.icon} {extra.text}
                      </span>
                    )}
                  </div>

                  {profile[equipment.profileKey] && route[equipment.routeField] && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.9rem", borderRadius: "10px", marginBottom: "0.8rem", background: route[equipment.routeField].startsWith("Áno") ? "#ecfdf5" : route[equipment.routeField].startsWith("Čias") ? "#fffbeb" : "#fef2f2", border: `1px solid ${route[equipment.routeField].startsWith("Áno") ? "#a7f3d0" : route[equipment.routeField].startsWith("Čias") ? "#fde68a" : "#fecaca"}`, fontSize: "0.82rem", color: route[equipment.routeField].startsWith("Áno") ? "#059669" : route[equipment.routeField].startsWith("Čias") ? "#d97706" : "#dc2626", fontWeight: "500" }}>
                      {equipment.label}: {route[equipment.routeField]}
                    </div>
                  )}

                  <p style={{ margin: "0 0 0.5rem", color: "#374151", fontSize: "0.88rem", lineHeight: 1.65 }}>✨ {route.highlights}</p>
                  <p style={{ margin: "0 0 0.5rem", color: theme.recommendationColor, fontSize: "0.88rem", fontStyle: "italic", lineHeight: 1.5 }}>💡 {route.recommendation}</p>
                  {route.warnings && route.warnings !== "null" && <p style={{ margin: "0 0 0.5rem", color: "#d97706", fontSize: "0.83rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "0.4rem 0.7rem" }}>⚠️ {route.warnings}</p>}

                  <WeatherForecast lat={route.startLat} lng={route.startLng} />

                  {route.pointsOfInterest?.length > 0 && (
                    <div style={{ marginTop: "1rem", borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                      <p style={{ margin: "0 0 0.55rem", fontSize: "0.78rem", color: theme.accentDark, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600" }}>🏛️ Zaujímavosti do 10 km</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        {route.pointsOfInterest.map((poi, j) => (
                          <div key={j} style={{ display: "flex", gap: "0.65rem", padding: "0.5rem 0.75rem", borderRadius: "10px", background: "#f9fafb", border: "1px solid #e5e7eb" }}>
                            <span style={{ fontSize: "1.05rem", flexShrink: 0 }}>{POI_ICONS[poi.type] || "📍"}</span>
                            <div>
                              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: "0.84rem", color: theme.textColor, fontWeight: "600" }}>{poi.name}</span>
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
                      <a href={`https://mapy.cz/${mapyPath}?x=${route.startLng}&y=${route.startLat}&z=15&source=coor&id=${route.startLng},${route.startLat}`}
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
                        ? `${base}@${lat},${lng}/tours?sport=${komootSport}`
                        : `${base}tours?sport=${komootSport}`;
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: theme.badgeBg, border: `1px solid ${theme.komootBorder}`, fontSize: "0.8rem", color: theme.komootColor, textDecoration: "none", fontWeight: "500" }}>
                          {theme.komootIcon} Hľadať na Komoot
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
                          const shared = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.75rem", borderRadius: "8px", background: theme.sourceBg, border: `1px solid ${theme.sourceBorder}`, fontSize: "0.8rem", fontWeight: "500" };
                          return href
                            ? <a key={src} href={href} target="_blank" rel="noopener noreferrer" style={{ ...shared, color: theme.sourceLinkColor, textDecoration: "none", cursor: "pointer" }}>🔗 {label}</a>
                            : <span key={src} style={{ ...shared, color: theme.sourcePlainColor }}>📄 {src}</span>;
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
                🌿 Tipy pre {tipsGroupDesc(profile)}
              </h4>
              <p style={{ margin: 0, color: "#78350f", lineHeight: 1.65, fontSize: "0.88rem" }}>{result.generalTips}</p>
            </div>
          )}

          <div style={{ textAlign: "center" }}>
            <button onClick={() => { setPhase("idle"); setResult(null); setLocation(""); }} style={{ padding: "0.6rem 1.4rem", borderRadius: "10px", border: `1px solid ${theme.softBorder}`, background: "#fff", color: theme.accentDark, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              🔄 Nové hľadanie
            </button>
          </div>
        </div>
      )}

      {phase === "idle" && !result && (
        <div style={{ textAlign: "center", color: "#9ca3af", marginTop: "3rem", fontSize: "0.9rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.35 }}>🗺️</div>
          Zadaj lokalitu — agent nájde {idleRoutesLabel}, zobrazí ich na mape<br />a pridá predpoveď počasia na 3 dni.
        </div>
      )}
    </div>
  );
}
