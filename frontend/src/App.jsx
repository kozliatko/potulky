import { useState } from "react";
import { GlobalStyles } from "./components/shared.jsx";
import BikeAgent from "./components/BikeAgent.jsx";
import HikeAgent from "./components/HikeAgent.jsx";

const MODES = [
  { id: "bike", icon: "🚴‍♀️", label: "Cyklistika" },
  { id: "hike", icon: "🥾",   label: "Turistika" },
];

export default function App() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("app-mode") || "bike"; } catch { return "bike"; }
  });

  const switchMode = m => {
    setMode(m);
    try { localStorage.setItem("app-mode", m); } catch {}
  };

  return (
    <>
      <GlobalStyles />

      {/* Prepínač módov */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        display: "flex", justifyContent: "center", gap: "0.35rem",
        padding: "0.55rem 1rem",
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid #e5e7eb",
        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
      }}>
        {MODES.map(m => {
          const active = mode === m.id;
          const isBike = m.id === "bike";
          return (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                padding: "0.4rem 1.2rem", borderRadius: "20px",
                border: `1.5px solid ${active ? (isBike ? "#059669" : "#d97706") : "#e5e7eb"}`,
                background: active ? (isBike ? "#ecfdf5" : "#fef3c7") : "#fff",
                color: active ? (isBike ? "#059669" : "#92400e") : "#6b7280",
                fontSize: "0.88rem", fontWeight: active ? "700" : "normal",
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: active ? `0 1px 6px ${isBike ? "rgba(5,150,105,0.2)" : "rgba(217,119,6,0.2)"}` : "none",
              }}
            >
              {m.icon} {m.label}
            </button>
          );
        })}
      </nav>

      {mode === "bike" ? <BikeAgent /> : <HikeAgent />}
    </>
  );
}
