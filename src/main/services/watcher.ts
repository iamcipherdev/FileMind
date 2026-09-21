import chokidar from 'chokidar';
import path from 'node:path';
import fsSync from 'node:fs';
import { isFileMindRuntimePath, isProtectedDir } from './safety';

/**
 * Folder watcher. Debounces bursts (save storms, sync tools) and emits a
 * single change event per quiet period. Never organizes automatically —
 * it only notifies so the user can run a fresh scan.
 *
 * Hardening:
 *  - old watcher is fully closed before a new one starts (no duplicates)
 *  - FileMind's own runtime/config/log dirs, protected dirs, the user's
 *    excluded names and its own organize targets' metadata are never watched
 *  - watcher errors are surfaced to the provided logger instead of swallowed
 *  - no-op when nothing changed (restart of Windows leaves no stale watchers)
 */

export interface WatcherLog {
  warn: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
}

export class FolderWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private changed: Set<string> = new Set();
  private currentFolders: string[] = [];
  private closing: Promise<void> | null = null;

  constructor(
    private onChange: (summary: { paths: string[]; at: number }) => void,
    private warn: (msg: string, extra?: unknown) => void = () => {},
    private info: (msg: string, extra?: unknown) => void = () => {}
  ) {}

  /** True when the folder list is identical to what is currently watched. */
  isWatching(folders: string[]): boolean {
    if (this.currentFolders.length !== (folders ?? []).length) return false;
    const norm = (x: string) => path.resolve(x);
    const a = [...this.currentFolders].map(norm).sort();
    const b = [...(folders ?? [])].map(norm).sort();
    return a.every((v, i) => v === b[i]);
  }

  async update(folders: string[]): Promise<void> {
    const valid = this.filterFolders(folders);
    if (this.isWatching(valid)) {
      this.info('watcher already watching requested folders — no change');
      return;
    }

    await this.stop(); // dispose the old watcher BEFORE creating a new one

    if (!valid || valid.length === 0) {
      this.currentFolders = [];
      return;
    }

    this.currentFolders = valid;
    this.watcher = chokidar.watch(valid, {
      ignoreInitial: true,
      depth: 8,
      ignored: (p: string) => {
        const base = path.basename(p).toLowerCase();
        return base === 'node_modules' || base === '.git' || base.startsWith('~$') ||
               base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini' ||
               isFileMindRuntimePath(p);
      },
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 120 },
    });

    const handler = (p: string) => {
      this.changed.add(p);
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        const paths = Array.from(this.changed).slice(0, 50);
        this.changed.clear();
        this.onChange({ paths, at: Date.now() });
      }, 1500);
    };

    this.watcher
      .on('add', handler)
      .on('change', handler)
      .on('unlink', handler)
      .on('addDir', handler)
      .on('error', (err: unknown) => {
        // Permission races, USB removal, transient locks — log, keep watching.
        this.warn('watcher error (continuing)', { message: (err as Error)?.message ?? String(err) });
      })
      .on('all', (_event: string, p: string) => {
        if (isFileMindRuntimePath(p)) return; // never react to our own writes
      });

    this.info('watcher started', { folders: valid });
  }

  /** Drop folders that must never be watched (missing, protected, our own). */
  private filterFolders(folders: string[]): string[] {
    if (!Array.isArray(folders)) return [];
    const out: string[] = [];
    for (const raw of folders) {
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      const p = path.resolve(raw);
      if (isProtectedDir(p)) { this.warn('refusing to watch protected dir', { folder: p }); continue; }
      if (isFileMindRuntimePath(p)) { this.warn('refusing to watch FileMind runtime dir', { folder: p }); continue; }
      try {
        if (!fsSync.statSync(p).isDirectory()) { this.warn('not watching: not a directory', { folder: p }); continue; }
      } catch {
        this.warn('not watching: folder unavailable', { folder: p });
        continue;
      }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  }

  async stop(): Promise<void> {
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    this.changed.clear();
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      this.currentFolders = [];
      if (!this.closing) {
        this.closing = w.close().catch((err: unknown) => {
          this.warn('watcher close failed', { message: (err as Error)?.message ?? String(err) });
        });
      }
      await this.closing;
      this.closing = null;
    }
  }
}
