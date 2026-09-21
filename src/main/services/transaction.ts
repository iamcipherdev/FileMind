import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import type { Suggestion, ApplyResult, UndoResult } from '../../shared/types';
import { assertSafeDestination, resolveConflict, SafetyError, isInsideRoot } from './safety';

/**
 * Transaction engine.
 *
 * Apply flow (write-ahead journal — crash safe by design):
 *   1. Validate every destination (in-root, safe name, not existing as dir).
 *   2. Persist an undo_log entry for every planned op BEFORE touching the disk.
 *   3. Perform ops in order, recording success/failure per item.
 *   4. Mark the batch applied. Never deletes anything — moves and renames only.
 *
 * Undo flow:
 *   1. Load the batch journal, newest entry first.
 *   2. For each entry, move the file back to its original path.
 *      If the original path was taken meanwhile, resolve a " (restored)" conflict
 *      instead of overwriting — overwriting is forbidden, always.
 *   3. Mark entries undone and record a history row.
 */

export interface JournalPort {
  addUndoEntry(batchId: string, index: number, op: 'move' | 'rename', fromPath: string, toPath: string): void;
  markBatchApplied(batchId: string, appliedCount: number, failedCount: number, summary: string): void;
  markBatchUndone(batchId: string, appliedCount: number, failedCount: number): void;
  getJournal(batchId: string): { entryIndex: number; op: 'move' | 'rename'; fromPath: string; toPath: string; undone: boolean }[];
  isBatchUndone(batchId: string): boolean;
}

export class TransactionEngine {
  constructor(private journal: JournalPort) {}

  async apply(suggestions: Suggestion[], organizeRoots: string[] = []): Promise<ApplyResult> {
    const batchId = crypto.randomUUID();
    const failed: { path: string; error: string }[] = [];
    let applied = 0;

    // Phase 0 — validate everything up-front; one bad suggestion never blocks the rest.
    const validated: { s: Suggestion; op: 'move' | 'rename' }[] = [];
    for (const s of suggestions) {
      try {
        const root = findRootFor(organizeRoots, s.fromPath);
        if (s.action === 'move' || s.action === 'move+rename') {
          assertSafeDestination(root, path.dirname(s.toPath));
        }
        if (path.resolve(s.fromPath) === path.resolve(s.toPath)) {
          throw new SafetyError('Source and destination are identical — nothing to do.');
        }
        validated.push({ s, op: s.action === 'rename' ? 'rename' : 'move' });
      } catch (e) {
        failed.push({ path: s.filePath, error: (e as Error).message });
      }
    }

    // Phase 1 — write the journal BEFORE touching the disk (write-ahead).
    validated.forEach(({ s, op }, i) => {
      this.journal.addUndoEntry(batchId, i, op, s.fromPath, s.toPath);
    });

    // Phase 2 — perform the operations.
    for (const { s, op } of validated) {
      try {
        await fs.access(s.fromPath); // source must still exist (race protection)
        await fs.mkdir(path.dirname(s.toPath), { recursive: true });

        if (op === 'move') {
          let dest = s.toPath;
          if (await exists(dest)) {
            const st = await fs.stat(dest);
            if (st.isDirectory()) {
              throw new SafetyError(`"${dest}" is a folder — refusing to overwrite it with a file.`);
            }
            dest = resolveConflict(dest, (p) => fsSyncExistsSync(p));
          }
          await fs.rename(s.fromPath, dest);
        } else {
          // rename in place
          const dest = resolveConflict(s.toPath, (p) => fsSyncExistsSync(p));
          await fs.rename(s.fromPath, dest);
        }
        applied += 1;
      } catch (e) {
        failed.push({ path: s.filePath, error: (e as Error).message || String(e) });
      }
    }

    // Phase 3 — record history.
    const summary = buildSummary(suggestions);
    this.journal.markBatchApplied(batchId, applied, failed.length, summary);

    return { batchId, applied, failed };
  }

  async undo(batchId: string): Promise<UndoResult> {
    const entries = this.journal.getJournal(batchId);
    if (entries.length === 0) {
      return { batchId, undone: 0, failed: [{ path: batchId, error: 'No journal found for this batch — nothing to undo.' }] };
    }
    if (this.journal.isBatchUndone(batchId)) {
      return { batchId, undone: 0, failed: [{ path: batchId, error: 'This batch was already undone.' }] };
    }

    const failed: { path: string; error: string }[] = [];
    let undone = 0;

    // Reverse order — safest for multi-step batches.
    for (const entry of [...entries].sort((a, b) => b.entryIndex - a.entryIndex)) {
      if (entry.undone) continue;
      try {
        if (!(await exists(entry.toPath))) {
          // Destination vanished (user moved it manually). Record and continue — never guess.
          throw new SafetyError(
            `"${entry.toPath}" is no longer there (maybe you moved it). Restore it manually or pick it up in a new scan.`
          );
        }
        await fs.mkdir(path.dirname(entry.fromPath), { recursive: true });
        let back = entry.fromPath;
        if (await exists(back)) {
          const dir = path.dirname(back);
          const ext = path.extname(back);
          const stem = path.basename(back, ext);
          back = resolveConflict(path.join(dir, `${stem} (restored)${ext}`), (p) => fsSyncExistsSync(p));
        }
        await fs.rename(entry.toPath, back);
        undone += 1;
      } catch (e) {
        failed.push({ path: entry.toPath, error: (e as Error).message });
      }
    }

    this.journal.markBatchUndone(batchId, undone, failed.length);
    return { batchId, undone, failed };
  }
}

function buildSummary(suggestions: Suggestion[]): string {
  const moves = suggestions.filter((s) => s.action !== 'rename').length;
  const renames = suggestions.length - moves;
  const bits: string[] = [];
  if (moves) bits.push(`${moves} move${moves === 1 ? '' : 's'}`);
  if (renames) bits.push(`${renames} rename${renames === 1 ? '' : 's'}`);
  return bits.join(', ') || 'no changes';
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function fsSyncExistsSync(p: string): boolean {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}

/** Deepest configured organize root that contains the source path (or its drive root as fallback). */
function findRootFor(roots: string[], filePath: string): string {
  let best: string | null = null;
  for (const root of roots) {
    if (isInsideRoot(root, filePath)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best ?? path.parse(path.resolve(filePath)).root;
}
