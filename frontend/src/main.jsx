import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// Bez tohto zostáva už otvorená záložka na starom JS v pamäti aj po tom,
// čo service worker na pozadí aktivuje novú verziu — stará appka potom
// posiela požiadavky v starom formáte, ktoré nový backend odmietne.
registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload();
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
