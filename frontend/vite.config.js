import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
        navigateFallbackDenylist: [/^\/history$/],
        skipWaiting: true,
        clientsClaim: true,
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
