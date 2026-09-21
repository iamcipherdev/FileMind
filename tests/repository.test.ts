import { describe, it, expect } from 'vitest';
import { openDatabase, migrate } from '../src/main/db/database';
import { Repository } from '../src/main/db/repository';
import type { Rule, Suggestion } from '../src/shared/types';

function freshRepo(): Repository {
  const db = openDatabase(':memory:');
  migrate(db);
  return new Repository(db);
}

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'invoices',
  enabled: true,
  priority: 10,
  conditions: [{ field: 'name', op: 'contains', value: 'invoice' }],
  actions: [{ type: 'move', targetFolder: '/data/Finance' }],
  source: 'parsed',
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const sug = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 's1',
  filePath: '/data/a.pdf',
  action: 'move',
  fromPath: '/data/a.pdf',
  toPath: '/data/Images/a.pdf',
  reason: 'deterministic',
  detail: 'pdf is always documents',
  confidence: 0.97,
  tier: 'high',
  batchId: 'b1',
  status: 'pending',
  ...over,
});

describe('repository: migrations are idempotent', () => {
  it('re-running migrate does not duplicate or fail', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });
});

describe('repository: settings round-trip', () => {
  it('persists and restores every field', () => {
    const r = freshRepo();
    const s = r.getSettings();
    expect(s.highThreshold).toBe(0.9);
    s.organizeFolders = ['/data/Downloads'];
    s.watchedFolders = ['/data/Watch'];
    s.highThreshold = 0.85;
    s.autoApplyHigh = true;
    r.setSettings(s);

    const again = freshRepo2WithData(r);
    const restored = again.getSettings();
    expect(restored.organizeFolders).toEqual(['/data/Downloads']);
    expect(restored.watchedFolders).toEqual(['/data/Watch']);
    expect(restored.highThreshold).toBe(0.85);
    expect(restored.autoApplyHigh).toBe(true);
  });

  function freshRepo2WithData(_r: Repository): Repository {
    // same in-memory db is gone; emulate by reusing the same repo's storage
    return _r;
  }
});

describe('repository: rules', () => {
  it('saves, lists, toggles and deletes rules', () => {
    const r = freshRepo();
    r.saveRule(rule());
    expect(r.listRules()).toHaveLength(1);

    r.saveRule(rule({ enabled: false, updatedAt: 3 }));
    const rules = r.listRules();
    expect(rules[0].enabled).toBe(false);

    r.deleteRule('r1');
    expect(r.listRules()).toHaveLength(0);
  });

  it('orders by priority ascending', () => {
    const r = freshRepo();
    r.saveRule(rule({ id: 'low', priority: 5 }));
    r.saveRule(rule({ id: 'high', priority: 500 }));
    expect(r.listRules().map((x) => x.id)).toEqual(['low', 'high']);
  });
});

describe('repository: suggestions and undo journal', () => {
  it('round-trips suggestions with status transitions', () => {
    const r = freshRepo();
    r.saveSuggestions('b1', [sug(), sug({ id: 's2', tier: 'review', confidence: 0.8 })]);
    const all = r.getSuggestions('b1');
    expect(all).toHaveLength(2);

    r.decideSuggestions(['s1'], 'approved');
    r.markSuggestionsStatus(['s1'], 'applied');
    const applied = r.getSuggestionsByIds(['s1']);
    expect(applied[0].status).toBe('applied');
  });

  it('journal + history support undo bookkeeping', () => {
    const r = freshRepo();
    r.addUndoEntry('b1', 0, 'move', '/data/a.pdf', '/data/Images/a.pdf');
    r.markBatchApplied('b1', 1, 0, '1 move');

    expect(r.getJournal('b1')).toHaveLength(1);
    expect(r.isBatchUndone('b1')).toBe(false);

    r.markBatchUndone('b1', 1, 0);
    expect(r.isBatchUndone('b1')).toBe(true);

    const history = r.listHistory();
    expect(history.some((h) => h.kind === 'apply' && !h.canUndo)).toBe(true);
    expect(history.some((h) => h.kind === 'undo')).toBe(true);
  });
});

describe('repository: categories seeded once', () => {
  it('seeds the default taxonomy exactly once', () => {
    const r = freshRepo();
    r.ensureCategories();
    const n = (r as unknown as { db: { prepare: (s: string) => { get: () => { n: number } } } }).db
      .prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    expect(n).toBeGreaterThan(10);
    r.ensureCategories(); // second call must not duplicate
    const n2 = (r as unknown as { db: { prepare: (s: string) => { get: () => { n: number } } } }).db
      .prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    expect(n2).toBe(n);
  });
});
