import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { TransactionEngine, JournalPort } from '../src/main/services/transaction';
import type { Suggestion } from '../src/shared/types';

let dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filemind-tx-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** In-memory journal used to unit-test the engine in isolation. */
function memJournal(): JournalPort & { entries: Map<string, { entryIndex: number; op: 'move' | 'rename'; fromPath: string; toPath: string; undone: boolean }[]> } {
  const entries = new Map<string, { entryIndex: number; op: 'move' | 'rename'; fromPath: string; toPath: string; undone: boolean }[]>();
  const undoneBatches = new Set<string>();
  return {
    entries,
    addUndoEntry(batchId, index, op, fromPath, toPath) {
      const arr = entries.get(batchId) ?? [];
      arr.push({ entryIndex: index, op, fromPath, toPath, undone: false });
      entries.set(batchId, arr);
    },
    markBatchApplied() {},
    markBatchUndone(batchId) { undoneBatches.add(batchId); const arr = entries.get(batchId) ?? []; arr.forEach((e) => (e.undone = true)); },
    getJournal(batchId) { return entries.get(batchId) ?? []; },
    isBatchUndone(batchId) { return undoneBatches.has(batchId); },
  };
}

const sug = (from: string, to: string): Suggestion => ({
  id: 's1',
  filePath: from,
  action: 'move',
  fromPath: from,
  toPath: to,
  reason: 'deterministic',
  detail: 'test',
  confidence: 0.97,
  tier: 'high',
  batchId: '',
  status: 'pending',
});

describe('transaction engine: apply', () => {
  it('moves files and records a journal', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.pdf'), 'A');
    const engine = new TransactionEngine(memJournal());

    const out = await engine.apply([sug(path.join(root, 'a.pdf'), path.join(root, 'Images', 'a.pdf'))], [root]);
    expect(out.applied).toBe(1);
    expect(out.failed).toHaveLength(0);
    expect(fs.existsSync(path.join(root, 'Images', 'a.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'a.pdf'))).toBe(false);
  });

  it('refuses to move outside the organize root', async () => {
    const root = tmp();
    const outside = tmp();
    fs.writeFileSync(path.join(root, 'a.pdf'), 'A');
    const engine = new TransactionEngine(memJournal());

    const out = await engine.apply([sug(path.join(root, 'a.pdf'), path.join(outside, 'a.pdf'))], [root]);
    expect(out.applied).toBe(0);
    expect(out.failed[0].error).toMatch(/outside|organize/i);
    expect(fs.existsSync(path.join(root, 'a.pdf'))).toBe(true); // untouched
  });

  it('does not overwrite existing files at the destination', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'Images'));
    fs.writeFileSync(path.join(root, 'a.pdf'), 'NEW');
    fs.writeFileSync(path.join(root, 'Images', 'a.pdf'), 'OLD');
    const engine = new TransactionEngine(memJournal());

    const out = await engine.apply([sug(path.join(root, 'a.pdf'), path.join(root, 'Images', 'a.pdf'))], [root]);
    expect(out.applied).toBe(1);
    expect(fs.readFileSync(path.join(root, 'Images', 'a.pdf'), 'utf8')).toBe('OLD');
    expect(fs.existsSync(path.join(root, 'Images', 'a (2).pdf'))).toBe(true);
  });

  it('a failing item never blocks the others', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.pdf'), 'A');
    fs.writeFileSync(path.join(root, 'b.pdf'), 'B');
    const engine = new TransactionEngine(memJournal());

    const out = await engine.apply([
      sug(path.join(root, 'missing.pdf'), path.join(root, 'X', 'missing.pdf')),
      sug(path.join(root, 'b.pdf'), path.join(root, 'X', 'b.pdf')),
    ], [root]);
    expect(out.applied).toBe(1);
    expect(out.failed).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'X', 'b.pdf'))).toBe(true);
  });
});

describe('transaction engine: undo', () => {
  it('restores every file to its original location', async () => {
    const root = tmp();
    const journal = memJournal();
    const engine = new TransactionEngine(journal);

    fs.writeFileSync(path.join(root, 'a.pdf'), 'A');
    fs.writeFileSync(path.join(root, 'b.pdf'), 'B');
    const out = await engine.apply([
      sug(path.join(root, 'a.pdf'), path.join(root, 'Images', 'a.pdf')),
      sug(path.join(root, 'b.pdf'), path.join(root, 'Docs', 'b.pdf')),
    ], [root]);
    expect(out.applied).toBe(2);

    const undoOut = await engine.undo(out.batchId);
    expect(undoOut.undone).toBe(2);
    expect(fs.readFileSync(path.join(root, 'a.pdf'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(root, 'b.pdf'), 'utf8')).toBe('B');
    expect(fs.existsSync(path.join(root, 'Images'))).toBe(true); // empty dir may remain
  });

  it('undo restores as "(restored)" instead of overwriting when the spot is taken', async () => {
    const root = tmp();
    const journal = memJournal();
    const engine = new TransactionEngine(journal);

    fs.writeFileSync(path.join(root, 'a.pdf'), 'ORIGINAL');
    const applyOut = await engine.apply([sug(path.join(root, 'a.pdf'), path.join(root, 'Images', 'a.pdf'))], [root]);

    // user recreates a file at the original spot before undoing
    fs.writeFileSync(path.join(root, 'a.pdf'), 'REPLACEMENT');
    await engine.undo(applyOut.batchId);

    expect(fs.readFileSync(path.join(root, 'a.pdf'), 'utf8')).toBe('REPLACEMENT');
    expect(fs.readFileSync(path.join(root, 'a (restored).pdf'), 'utf8')).toBe('ORIGINAL');
  });

  it('double undo is refused with a clear message', async () => {
    const root = tmp();
    const engine = new TransactionEngine(memJournal());
    fs.writeFileSync(path.join(root, 'a.pdf'), 'A');
    const out = await engine.apply([sug(path.join(root, 'a.pdf'), path.join(root, 'Images', 'a.pdf'))], [root]);
    await engine.undo(out.batchId);
    const again = await engine.undo(out.batchId);
    expect(again.undone).toBe(0);
    expect(again.failed[0].error).toMatch(/already undone/i);
  });

  it('unknown batch ids fail gracefully, never crash', async () => {
    const engine = new TransactionEngine(memJournal());
    const out = await engine.undo('no-such-batch');
    expect(out.undone).toBe(0);
    expect(out.failed[0].error).toMatch(/no journal/i);
  });
});
