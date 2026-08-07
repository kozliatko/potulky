/**
 * Smoke testy — overujú, že aplikácia beží a odpovedá správne.
 * Spúšťajú sa proti živým Docker kontajnerom.
 *
 * Použitie:
 *   BASE_URL=http://localhost:3001 node --test tests/smoke.test.js
 *   alebo cez npm test z koreňa projektu
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

async function get(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    ...opts,
  });
  return res;
}

// ─── Health ──────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("vracia 200 so status:ok a ISO timestampom", async () => {
    const res = await get("/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Frontend ────────────────────────────────────────────────────────────────

describe("Frontend statické súbory", () => {
  it("GET / vracia HTML s obsahom", async () => {
    const res = await get("/");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<html") || text.includes("<!DOCTYPE"), "Odpoveď musí byť HTML");
  });

  it("GET /favicon.ico vracia 200", async () => {
    const res = await get("/favicon.ico");
    assert.ok([200, 304].includes(res.status), `Očakávaný 200/304, dostal ${res.status}`);
  });

  it("GET /pwa-192x192.png vracia 200", async () => {
    const res = await get("/pwa-192x192.png");
    assert.ok([200, 304].includes(res.status), `Očakávaný 200/304, dostal ${res.status}`);
  });

  it("SPA fallback — neznáma cesta vracia index.html", async () => {
    const res = await get("/neexistujuca-stranka-xyz");
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/html"), `Očakávaný text/html, dostal: ${ct}`);
  });
});

// ─── API validácia ────────────────────────────────────────────────────────────
// Server sám skladá system prompt (mode + profile); klient neposiela system/messages/max_tokens.

describe("POST /api/messages — validácia vstupu", () => {
  it("vracia 400 keď chýba telo požiadavky", async () => {
    const res = await get("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, "Musí obsahovať pole error");
  });

  it("vracia 400 pri neplatnom mode", async () => {
    const res = await get("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "neexistuje", location: "Trenčín" }),
    });
    assert.equal(res.status, 400);
  });

  it("vracia 400 keď chýba location", async () => {
    const res = await get("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "bike" }),
    });
    assert.equal(res.status, 400);
  });
});

// ─── Neznáme API endpointy ────────────────────────────────────────────────────

describe("Neznáme API endpointy", () => {
  it("GET /api/neznamy vracia 404", async () => {
    const res = await get("/api/neznamy-endpoint");
    assert.equal(res.status, 404);
  });
});

// ─── Bezpečnostné hlavičky ────────────────────────────────────────────────────

describe("Bezpečnostné HTTP hlavičky", () => {
  it("X-Content-Type-Options je nosniff", async () => {
    const res = await get("/");
    const header = res.headers.get("x-content-type-options");
    // Hlavička je nastavovaná Caddyom — pri priamom prístupe (port 3001) nemusí byť.
    if (header) {
      assert.equal(header, "nosniff");
    }
  });

  it("Server hlavička nie je exponovaná", async () => {
    const res = await get("/health");
    const server = res.headers.get("server") || "";
    // Caddy nastavuje -Server, pri priamom prístupe môže byť express default
    assert.ok(!server.toLowerCase().includes("caddy"), "Caddy nesmie exponovať 'Server' hlavičku");
  });
});
