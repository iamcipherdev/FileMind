import type { Database } from './database';
import type {
  Rule, Suggestion, HistoryEntry, UndoEntryRecord, FileMindSettings,
} from '../../shared/types';
import { DEFAULT_CATEGORIES } from '../services/categories';

/** Typed repositories over the raw database. All persistence goes through here. */

const DEFAULT_SETTINGS: FileMindSettings = {
  watchedFolders: [],
  organizeFolders: [],
  excludedNames: ['.filemind', 'desktop.ini', 'thumbs.db', '.ds_store'],
  highThreshold: 0.9,
  reviewThreshold: 0.7,
  autoApplyHigh: false,
  contentExtractEnabled: true,
  maxContentBytes: 2 * 1024 * 1024,
};

/**
 * Best-effort salvage of a corrupted folder-list row. Accepts a bare
 * Windows/Unix path string, or a JSON-ish fragment containing quoted paths.
 * Returns null when nothing recoverable is found.
 */
export function salvageFolderList(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const looksLikePath = (p: string) => /^([a-zA-Z]:[\\/]|\/)/.test(p) && !p.includes('\u0000');
  if (looksLikePath(trimmed)) return [trimmed];
  const matches = raw.match(/"[^"]+"|'[^']+'/g);
  if (matches && matches.length > 0) {
    const paths = matches
      .map((m) => m.slice(1, -1))
      .map((p) => p.replace(/\\(?:\\|\/)/g, (m0) => (m0 === '\\\\' ? '\\' : '/'))) // unescape JSON string escapes
      .filter((p) => p.length > 2 && looksLikePath(p));
    if (paths.length > 0) return paths;
  }
  return null;
}

export class Repository {
  constructor(private db: Database) {}

  // ---------- settings ----------
  /**
   * Fault-tolerant settings reader. A corrupted or maliciously malformed row
   * must NEVER take the app down: each key is parsed independently, invalid
   * values fall back to defaults (or are salvaged when partially valid).
   */
  getSettings(): FileMindSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    const json = (key: string, fallback: unknown): unknown => {
      const raw = map[key];
      if (raw === undefined || raw === null) return fallback;
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || parsed === undefined) return fallback;
        return parsed;
      } catch {
        // Salvage: the row may be a bare string (legacy/manual edit) or truncated.
        const salvaged = salvageFolderList(raw);
        return salvaged ?? fallback;
      }
    };
    const num = (key: string, fallback: number, min: number, max: number): number => {
      const n = Number(map[key]);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const bool = (key: string, fallback: boolean): boolean => {
      const v = map[key];
      if (v === undefined) return fallback;
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      return fallback;
    };

    const strArray = (key: string): string[] => {
      const v = json(key, []);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      // A bare string where an array belongs: keep it only if it looks like a path.
      if (typeof v === 'string' && /^([a-zA-Z]:[\\/]|\/)/.test(v.trim())) return [v.trim()];
      return [];
    };

    return {
      watchedFolders: strArray('watchedFolders'),
      organizeFolders: strArray('organizeFolders'),
      excludedNames: (() => {
        const v = strArray('excludedNames');
        return v.length > 0 ? v : DEFAULT_SETTINGS.excludedNames;
      })(),
      highThreshold: num('highThreshold', DEFAULT_SETTINGS.highThreshold, 0.5, 1),
      reviewThreshold: num('reviewThreshold', DEFAULT_SETTINGS.reviewThreshold, 0.3, 0.95),
      autoApplyHigh: bool('autoApplyHigh', DEFAULT_SETTINGS.autoApplyHigh),
      contentExtractEnabled: bool('contentExtractEnabled', DEFAULT_SETTINGS.contentExtractEnabled),
      maxContentBytes: (() => {
        const n = num('maxContentBytes', DEFAULT_SETTINGS.maxContentBytes, 1024, 64 * 1024 * 1024);
        return Math.round(n);
      })(),
    };
  }

  setSettings(s: FileMindSettings): void {
    const upsert = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    this.db.transaction(() => {
      const pairs: [string, string][] = [
        ['watchedFolders', JSON.stringify(s.watchedFolders)],
        ['organizeFolders', JSON.stringify(s.organizeFolders)],
        ['excludedNames', JSON.stringify(s.excludedNames)],
        ['highThreshold', String(s.highThreshold)],
        ['reviewThreshold', String(s.reviewThreshold)],
        ['autoApplyHigh', String(s.autoApplyHigh)],
        ['contentExtractEnabled', String(s.contentExtractEnabled)],
        ['maxContentBytes', String(s.maxContentBytes)],
      ];
      for (const [k, v] of pairs) upsert.run(k, v);
    })();
  }

  // ---------- categories ----------
  ensureCategories(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
    if (count > 0) return;
    const ins = this.db.prepare('INSERT OR REPLACE INTO categories (id, name, color, icon, sort) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      for (const c of DEFAULT_CATEGORIES) ins.run(c.id, c.name, c.color, c.icon, c.sort);
    })();
  }

  // ---------- rules ----------
  listRules(): Rule[] {
    const rows = this.db.prepare('SELECT * FROM rules ORDER BY priority ASC, updated_at DESC').all() as Record<string, unknown>[];
    return rows.map(rowToRule);
  }

  saveRule(rule: Rule): void {
    this.db.prepare(`
      INSERT INTO rules (id, name, enabled, priority, conditions_json, actions_json, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, enabled=excluded.enabled, priority=excluded.priority,
        conditions_json=excluded.conditions_json, actions_json=excluded.actions_json,
        source=excluded.source, updated_at=excluded.updated_at
    `).run(
      rule.id, rule.name, rule.enabled ? 1 : 0, rule.priority,
      JSON.stringify(rule.conditions), JSON.stringify(rule.actions),
      rule.source, rule.createdAt, rule.updatedAt,
    );
  }

  deleteRule(id: string): void {
    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
  }

  // ---------- suggestions ----------
  saveSuggestions(batchId: string, suggestions: Suggestion[]): void {
    const ins = this.db.prepare(`
      INSERT OR REPLACE INTO suggestions (id, file_path, action, from_path, to_path, reason, rule_id, detail, confidence, tier, batch_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const s of suggestions) {
        ins.run(s.id, s.filePath, s.action, s.fromPath, s.toPath, s.reason, s.ruleId ?? null,
          s.detail, s.confidence, s.tier, s.batchId ?? batchId, s.status, Date.now());
      }
    })();
  }

  getSuggestions(batchId?: string): Suggestion[] {
    const rows = (batchId
      ? this.db.prepare('SELECT * FROM suggestions WHERE batch_id = ? ORDER BY confidence DESC').all(batchId)
      : this.db.prepare("SELECT * FROM suggestions WHERE status IN ('pending','approved') ORDER BY created_at DESC, confidence DESC").all()
    ) as Record<string, unknown>[];
    return rows.map(rowToSuggestion);
  }

  decideSuggestions(ids: string[], decision: 'approved' | 'rejected'): void {
    const upd = this.db.prepare('UPDATE suggestions SET status = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const id of ids) upd.run(decision, id);
    })();
  }

  getSuggestionsByIds(ids: string[]): Suggestion[] {
    if (ids.length === 0) return [];
    const rows = this.db.prepare('SELECT * FROM suggestions').all() as Record<string, unknown>[];
    const idSet = new Set(ids);
    return rows.filter((r) => idSet.has(r.id as string)).map(rowToSuggestion);
  }

  markSuggestionsStatus(ids: string[], status: string): void {
    const upd = this.db.prepare('UPDATE suggestions SET status = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const id of ids) upd.run(status, id);
    })();
  }

  // ---------- history + undo journal ----------
  addUndoEntry(batchId: string, index: number, op: 'move' | 'rename', fromPath: string, toPath: string): void {
    this.db.prepare('INSERT INTO undo_log (batch_id, entry_index, op, from_path, to_path) VALUES (?, ?, ?, ?, ?)')
      .run(batchId, index, op, fromPath, toPath);
  }

  getJournal(batchId: string) {
    return (this.db.prepare('SELECT entry_index, op, from_path, to_path, undone FROM undo_log WHERE batch_id = ? ORDER BY entry_index ASC').all(batchId) as Record<string, unknown>[])
      .map((r) => ({
        entryIndex: r.entry_index as number,
        op: r.op as 'move' | 'rename',
        fromPath: r.from_path as string,
        toPath: r.to_path as string,
        undone: (r.undone as number) === 1,
      }));
  }

  isBatchUndone(batchId: string): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM history WHERE batch_id = ? AND kind = 'undo'").get(batchId) as { n: number };
    return row.n > 0;
  }

  markBatchApplied(batchId: string, appliedCount: number, failedCount: number, summary: string): void {
    this.db.prepare('INSERT INTO history (batch_id, kind, summary, applied_count, failed_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(batchId, 'apply', summary, appliedCount, failedCount, Date.now());
  }

  markBatchUndone(batchId: string, appliedCount: number, failedCount: number): void {
    this.db.prepare('UPDATE undo_log SET undone = 1 WHERE batch_id = ?').run(batchId);
    this.db.prepare('INSERT INTO history (batch_id, kind, summary, applied_count, failed_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(batchId, 'undo', 'reverted', appliedCount, failedCount, Date.now());
    this.db.prepare("UPDATE suggestions SET status = 'undone' WHERE batch_id = ? AND status = 'applied'").run(batchId);
  }

  listHistory(): HistoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT 200').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      batchId: r.batch_id as string,
      kind: r.kind as 'apply' | 'undo',
      summary: r.summary as string,
      appliedCount: r.applied_count as number,
      failedCount: r.failed_count as number,
      createdAt: r.created_at as number,
      canUndo: r.kind === 'apply' && !this.isBatchUndone(r.batch_id as string),
    }));
  }

  getBatchEntries(batchId: string): UndoEntryRecord[] {
    return this.getJournal(batchId).map((e) => ({
      entryIndex: e.entryIndex, op: e.op, fromPath: e.fromPath, toPath: e.toPath, undone: e.undone,
    }));
  }

  // ---------- stats ----------
  stats(): { files: number; rules: number; pendingSuggestions: number; appliedBatches: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      files: one('SELECT COUNT(*) AS n FROM files'),
      rules: one('SELECT COUNT(*) AS n FROM rules WHERE enabled = 1'),
      pendingSuggestions: one("SELECT COUNT(*) AS n FROM suggestions WHERE status = 'pending'"),
      appliedBatches: one("SELECT COUNT(DISTINCT batch_id) AS n FROM history WHERE kind = 'apply'"),
    };
  }

  saveFileIndex(files: { path: string; name: string; ext: string; sizeBytes: number; mtimeMs: number; ageDays: number; isSymlink: boolean; contentSnippet?: string | null; category?: string; categorySource?: string; confidence?: number }[], batchId: string): void {
    const ins = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, name, ext, size_bytes, mtime_ms, age_days, is_symlink, content_snippet, category, category_source, confidence, scan_batch, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const f of files) {
        ins.run(f.path, f.name, f.ext, f.sizeBytes, f.mtimeMs, f.ageDays, f.isSymlink ? 1 : 0,
          f.contentSnippet ?? null, f.category ?? null, f.categorySource ?? null, f.confidence ?? null, batchId, Date.now());
      }
    })();
  }

  close(): void {
    this.db.close();
  }
}

function rowToRule(r: Record<string, unknown>): Rule {
  return {
    id: r.id as string,
    name: r.name as string,
    enabled: (r.enabled as number) === 1,
    priority: r.priority as number,
    conditions: JSON.parse(r.conditions_json as string),
    actions: JSON.parse(r.actions_json as string),
    source: r.source as Rule['source'],
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToSuggestion(r: Record<string, unknown>): Suggestion {
  return {
    id: r.id as string,
    filePath: r.file_path as string,
    action: r.action as Suggestion['action'],
    fromPath: r.from_path as string,
    toPath: r.to_path as string,
    reason: r.reason as Suggestion['reason'],
    ruleId: (r.rule_id as string) ?? undefined,
    detail: r.detail as string,
    confidence: r.confidence as number,
    tier: r.tier as Suggestion['tier'],
    batchId: r.batch_id as string,
    status: r.status as Suggestion['status'],
  };
}
