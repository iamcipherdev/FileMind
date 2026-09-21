import chokidar from 'chokidar';
import path from 'node:path';

/**
 * Folder watcher. Debounces bursts (save storms, sync tools) and emits a
 * single change event per quiet period. Never organizes automatically —
 * it only notifies so the user can run a fresh scan.
 */
export class FolderWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private changed: Set<string> = new Set();

  constructor(private onChange: (summary: { paths: string[]; at: number }) => void) {}

  update(folders: string[]): void {
    this.stop();
    if (!folders || folders.length === 0) return;

    this.watcher = chokidar.watch(folders, {
      ignoreInitial: true,
      depth: 8,
      ignored: (p: string) => {
        const base = path.basename(p).toLowerCase();
        return base === 'node_modules' || base === '.git' || base.startsWith('~$') || base === '.ds_store' || base === 'thumbs.db';
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
      .on('error', () => { /* permission races happen; next scan re-reads reality */ });
  }

  stop(): void {
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }
}
