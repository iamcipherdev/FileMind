import path from 'node:path';
import fs from 'node:fs';

/**
 * Database layer. Uses better-sqlite3 (synchronous, transactional — ideal for
 * a desktop app). Loaded lazily so unit tests and typecheck never require the
 * native module.
 */

export type Database = {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  pragma(statement: string): unknown;
  close(): void;
};

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial-schema',
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL,
  icon  TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  ext          TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  mtime_ms     INTEGER NOT NULL,
  age_days     INTEGER NOT NULL DEFAULT 0,
  is_symlink   INTEGER NOT NULL DEFAULT 0,
  content_snippet TEXT,
  category     TEXT,
  category_source TEXT,
  confidence   REAL,
  scan_batch   TEXT,
  indexed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_scan ON files(scan_batch);

CREATE TABLE IF NOT EXISTS rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 100,
  conditions_json TEXT NOT NULL,
  actions_json    TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id         TEXT PRIMARY KEY,
  file_path  TEXT NOT NULL,
  action     TEXT NOT NULL,
  from_path  TEXT NOT NULL,
  to_path    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  rule_id    TEXT,
  detail     TEXT NOT NULL,
  confidence REAL NOT NULL,
  tier       TEXT NOT NULL,
  batch_id   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_batch ON suggestions(batch_id);

CREATE TABLE IF NOT EXISTS history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  applied_count INTEGER NOT NULL,
  failed_count  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT NOT NULL,
  entry_index INTEGER NOT NULL,
  op          TEXT NOT NULL,
  from_path   TEXT NOT NULL,
  to_path     TEXT NOT NULL,
  undone      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_undo_batch ON undo_log(batch_id);
`,
  },
];

export function openDatabase(dbPath: string): Database {
  const req = eval('require') as NodeRequire;
  const BetterSqlite3 = req('better-sqlite3');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath) as Database;
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
    })();
  }
}
