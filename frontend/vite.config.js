import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (nie "autoUpdate"): pri autoUpdate vite-plugin-pwa natvrdo
      // vynúti workbox.skipWaiting/clientsClaim = true bez ohľadu na nižšie
      // nastavenie, čím rozbije onNeedRefresh banner flow (pozri komentár
      // pri workbox nižšie).
      registerType: "prompt",
      injectRegister: "auto",
      selfDestroying: false,
      includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Potulky – Cyklotrasy & Turistika",
        short_name: "Potulky",
        description: "AI agent pre hľadanie cyklotrás a turistických vychádzok. Trasy na mieru pre rodiny s deťmi, kočíkom aj e-bike.",
        theme_color: "#059669",
        background_color: "#f0fdf4",
        display: "standalone",
        orientation: "portrait-primary",
        lang: "sk",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-64x64.png",            sizes: "64x64",   type: "image/png" },
          { src: "pwa-192x192.png",           sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png",           sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // history.js patrí len k /history admin stránke (basic_auth), nie
        // k samotnej appke — bežní návštevníci ho nikdy nepotrebujú. Bez
        // tohto ho SW precachoval každému, čo bolo zbytočné dáta navyše
        // a zároveň priama príčina neželaného basic_auth popupu (SW si ho
        // sťahoval na pozadí a narazil na chránenú cestu).
        globIgnores: ["history.js"],
        navigateFallbackDenylist: [/^\/history$/],
        // skipWaiting/clientsClaim: true tu paradoxne rozbíjali update flow —
        // nový SW sa aktivoval skôr, než ho onNeedRefresh stihol zachytiť vo
        // "waiting" stave, takže banner/reload sa nikdy nespustil (klient
        // ostal ticho na starej verzii). Bez nich nový SW počká na explicitný
        // SKIP_WAITING signál, ktorý posiela updateSW(true) v main.jsx.
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "weather-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.js",
    coverage: {
      // public/ je statický passthrough (napr. history.js pre /history admin
      // stránku, servované backendom) — nie je súčasťou React appky.
      exclude: ["public/**", "**/*.config.js", "dist/**"],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://backend:3001",
        changeOrigin: true,
      },
    },
  },
});
