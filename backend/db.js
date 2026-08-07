import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "activity.db");

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS searches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ip            TEXT,
    user_agent    TEXT,
    location      TEXT,
    search_count  INTEGER DEFAULT 0,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    duration_ms   INTEGER,
    status        TEXT    DEFAULT 'ok',
    error         TEXT
  )
`);

export const insertSearch = db.prepare(`
  INSERT INTO searches
    (created_at, ip, user_agent, location, search_count, input_tokens, output_tokens, duration_ms, status, error)
  VALUES
    (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export const getHistory = () =>
  db.prepare("SELECT * FROM searches ORDER BY id DESC LIMIT 500").all();

export const getStats = () =>
  db.prepare(`
    SELECT
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END)  AS ok_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      SUM(search_count)                                AS total_web_searches,
      SUM(input_tokens)                                AS total_input_tokens,
      SUM(output_tokens)                               AS total_output_tokens,
      COUNT(DISTINCT ip)                               AS unique_ips,
      ROUND(AVG(CASE WHEN status='ok' THEN duration_ms END))  AS avg_duration_ms
    FROM searches
  `).get();

// ─── Denné kvóty a rozpočet ───────────────────────────────────────────────────
// "Dnes" počítané v UTC, zhodne s created_at (strftime('%Y-%m-%dT...Z', 'now')).

const countByIpToday = db.prepare(`
  SELECT COUNT(*) AS count FROM searches
  WHERE ip = ? AND created_at >= date('now')
`);

export const requestsTodayByIp = ip => countByIpToday.get(ip).count;

const countGlobalToday = db.prepare(`
  SELECT COUNT(*) AS count FROM searches
  WHERE created_at >= date('now')
`);

export const requestsToday = () => countGlobalToday.get().count;

const byIpToday = db.prepare(`
  SELECT
    ip,
    COUNT(*)              AS request_count,
    SUM(search_count)     AS total_searches,
    SUM(input_tokens)     AS total_input_tokens,
    SUM(output_tokens)    AS total_output_tokens
  FROM searches
  WHERE created_at >= date('now')
  GROUP BY ip
  ORDER BY request_count DESC
`);

export const requestsTodayByIpBreakdown = () => byIpToday.all();

// ─── Retencia dát ─────────────────────────────────────────────────────────────
// IP adresy a lokality sú osobné/citlivé údaje — nezachovávame ich navždy.

const RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS) || 90;

const pruneOld = db.prepare(`
  DELETE FROM searches WHERE created_at < datetime('now', '-' || ? || ' days')
`);

export const pruneOldRecords = () => pruneOld.run(RETENTION_DAYS).changes;

export { db };
