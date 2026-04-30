import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: '{"summary":"test"}' }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  })),
}));

const { default: app } = await import("./server.js");

describe("GET /health", () => {
  it("returns status ok with ISO timestamp", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("POST /api/messages — validácia", () => {
  it("vracia 400 keď chýba pole messages", async () => {
    const res = await request(app)
      .post("/api/messages")
      .send({ model: "claude-sonnet-4-20250514" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("vracia 400 keď messages nie je pole", async () => {
    const res = await request(app)
      .post("/api/messages")
      .send({ messages: "neplatne" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("vracia odpoveď pre platné pole messages", async () => {
    const res = await request(app)
      .post("/api/messages")
      .send({ messages: [{ role: "user", content: "ahoj" }] });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeDefined();
    expect(Array.isArray(res.body.content)).toBe(true);
  });

  it("použije predvolený model keď nie je zadaný", async () => {
    const res = await request(app)
      .post("/api/messages")
      .send({ messages: [{ role: "user", content: "test" }] });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/messages — auth middleware", () => {
  beforeEach(() => { process.env.API_SECRET_TOKEN = "tajny-token-123"; });
  afterEach(() => { delete process.env.API_SECRET_TOKEN; });

  it("vracia 401 keď token chýba", async () => {
    const res = await request(app)
      .post("/api/messages")
      .send({ messages: [{ role: "user", content: "test" }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("vracia 401 pri zlom tokene", async () => {
    const res = await request(app)
      .post("/api/messages")
      .set("x-api-token", "zly-token")
      .send({ messages: [{ role: "user", content: "test" }] });
    expect(res.status).toBe(401);
  });

  it("povolí prístup so správnym tokenom", async () => {
    const res = await request(app)
      .post("/api/messages")
      .set("x-api-token", "tajny-token-123")
      .send({ messages: [{ role: "user", content: "test" }] });
    expect(res.status).toBe(200);
  });
});
