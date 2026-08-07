import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// Bez tohto zostáva už otvorená záložka na starom JS v pamäti aj po tom,
// čo service worker na pozadí aktivuje novú verziu — stará appka potom
// posiela požiadavky v starom formáte, ktoré nový backend odmietne.
//
// Samotný "onNeedRefresh" callback sa ale spolieha na to, že prehliadač
// aktívne skontroluje nový service worker — pri SPA bez plnej navigácie
// (appka pridaná na plochu, dlho otvorená záložka) sa to prirodzene stane
// zriedka, takže update vie ostať nepovšimnutý aj dni. Preto:
//  1. pravidelne (a pri návrate appky z pozadia) vynucujeme kontrolu,
//  2. update neaplikujeme potichu — ukážeme banner s tlačidlom Obnoviť,
//     nech neprepíšeme rozpísaný vstup pod rukami,
//  3. banner má poistku — ak si ho nikto nevšimne, obnoví sa sám.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hodina
const AUTO_RELOAD_FALLBACK_MS  = 60 * 1000;       // poistka, ak nikto neklikne

function showUpdateBanner(reload) {
  if (document.getElementById("pwa-update-banner")) return;

  const bar = document.createElement("div");
  bar.id = "pwa-update-banner";
  bar.setAttribute("role", "alert");
  bar.style.cssText = `
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom, 0px));
    background: #059669; color: #fff; font-family: system-ui, -apple-system, sans-serif;
    font-size: 0.85rem; box-shadow: 0 -2px 12px rgba(0,0,0,0.18);
  `;
  bar.innerHTML = `
    <span>🔄 K dispozícii je nová verzia Potuliek.</span>
    <button id="pwa-update-btn" type="button" style="padding:0.35rem 0.9rem;border-radius:8px;border:none;background:#fff;color:#059669;font-weight:600;font-size:0.82rem;cursor:pointer;font-family:inherit">Obnoviť teraz</button>
  `;
  document.body.appendChild(bar);
  document.getElementById("pwa-update-btn").addEventListener("click", reload);
  setTimeout(reload, AUTO_RELOAD_FALLBACK_MS);
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    showUpdateBanner(() => updateSW(true));
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
