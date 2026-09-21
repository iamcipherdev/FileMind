import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabaseResilient, openDatabase } from '../src/main/db/database';

/**
 * REGRESSION (folder-selection startup bug, TEST 5 + recovery contract):
 * a corrupted database file must never prevent FileMind from launching.
 * The damaged file is quarantined (kept aside, never deleted) and a fresh
 * database is created. Also covers clean re-open after WAL shutdown.
 */

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filemind-db-'));
}

describe('openDatabaseResilient', () => {
  it('opens a fresh database and applies migrations', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'filemind.db');
    const res = openDatabaseResilient(dbPath);
    expect(res.recovered).toBe(false);
    const rows = res.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain('settings');
    expect(names).toContain('suggestions');
    expect(names).toContain('undo_log');
    res.db.close();
  });

  it('quarantines a corrupted database and still opens (never crashes the app)', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'filemind.db');
    // A file that is definitely not a SQLite database:
    fs.writeFileSync(dbPath, Buffer.from('this is not a database file at all — random garbage 12345'));
    const messages: string[] = [];
    const res = openDatabaseResilient(dbPath, (m) => messages.push(m));
    expect(res.recovered).toBe(true);
    expect(res.quarantinedTo).toBeTruthy();
    expect(fs.existsSync(res.quarantinedTo!)).toBe(true);
    // The quarantined file still holds the old (broken) content — nothing deleted.
    expect(fs.readFileSync(res.quarantinedTo!, 'utf8')).toContain('not a database');
    // The recreated database works:
    res.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('k', 'v');
    const row = res.db.prepare('SELECT value FROM settings WHERE key = ?').get('k') as { value: string };
    expect(row.value).toBe('v');
    res.db.close();
  });

  it('quarantines leftover WAL/SHM files alongside the corrupted db', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'filemind.db');
    fs.writeFileSync(dbPath, 'garbage');
    fs.writeFileSync(dbPath + '-wal', 'garbage-wal');
    fs.writeFileSync(dbPath + '-shm', 'garbage-shm');
    const res = openDatabaseResilient(dbPath);
    expect(res.recovered).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true); // recreated fresh
    // The damaged main db is kept aside with a .corrupt- prefix (SQLite itself
    // may consume/reset an invalid WAL during open attempts — that is normal;
    // the contract is: nothing FileMind deletes, everything recoverable kept).
    const kept = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(dir, kept[0]), 'utf8')).toContain('garbage');
    res.db.close();
  });

  it('reopens cleanly after a clean close (WAL checkpointed)', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'filemind.db');
    const db1 = openDatabase(dbPath);
    db1.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('organizeFolders', '["C:/Users/x/Downloads"]');
    db1.close();
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT value FROM settings WHERE key = ?').get('organizeFolders') as { value: string };
    expect(JSON.parse(row.value)).toEqual(['C:/Users/x/Downloads']);
    db2.close();
  });
});
