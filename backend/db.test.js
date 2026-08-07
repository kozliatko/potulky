import { describe, it, expect, beforeEach } from "vitest";

process.env.DB_PATH = ":memory:";

describe("pruneOldRecords", () => {
  it("vymaže záznamy staršie ako RETENTION_DAYS, novšie ponechá", async () => {
    process.env.HISTORY_RETENTION_DAYS = "90";
    const { db, pruneOldRecords } = await import("./db.js");

    db.prepare(`
      INSERT INTO searches (created_at, ip, location, status)
      VALUES (datetime('now', '-100 days'), '1.1.1.1', 'stará', 'ok')
    `).run();
    db.prepare(`
      INSERT INTO searches (created_at, ip, location, status)
      VALUES (datetime('now', '-10 days'), '2.2.2.2', 'nová', 'ok')
    `).run();

    const deleted = pruneOldRecords();
    expect(deleted).toBe(1);

    const remaining = db.prepare("SELECT location FROM searches").all();
    expect(remaining).toEqual([{ location: "nová" }]);
  });
});
