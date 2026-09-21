import path from 'node:path';
import fs from 'node:fs/promises';
import type { ScannedFile } from '../../shared/types';
import { isProtectedDir } from './safety';
import { kindForExt } from './categories';

export interface ScanOptions {
  excludedNames?: string[];        // skip these folder/file names anywhere in the tree
  followSymlinks?: boolean;        // never by default
  maxDepth?: number;               // default 12
  onProgress?: (scanned: number, currentPath: string, estimate: number | null) => void;
  shouldCancel?: () => boolean;
  onFile?: (file: ScannedFile) => void;
}

export interface ScanSummary {
  files: ScannedFile[];
  scanned: number;
  skippedDirs: string[];
  errors: { path: string; error: string }[];
  cancelled: boolean;
}

const DEFAULT_EXCLUDES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'AppData', '$Recycle.Bin',
  'System Volume Information', '.cache', '.tmp', '__pycache__', '.venv', 'venv',
]);

/**
 * Cancellable, iterative (no recursion → no stack overflow on deep trees) scanner.
 * Emits files in batches via onFile so the pipeline can stream into analysis.
 */
export async function scanFolders(roots: string[], opts: ScanOptions = {}): Promise<ScanSummary> {
  const excluded = new Set([...DEFAULT_EXCLUDES, ...(opts.excludedNames ?? [])]);
  const maxDepth = opts.maxDepth ?? 12;
  const files: ScannedFile[] = [];
  const skippedDirs: string[] = [];
  const errors: { path: string; error: string }[] = [];
  let scanned = 0;
  let cancelled = false;

  for (const root of roots) {
    const queue: { dir: string; depth: number }[] = [{ dir: path.resolve(root), depth: 0 }];

    while (queue.length > 0) {
      if (opts.shouldCancel?.()) { cancelled = true; break; }
      const { dir, depth } = queue.shift()!;

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        errors.push({ path: dir, error: readableFsError(err, dir) });
        continue;
      }

      for (const entry of entries) {
        if (opts.shouldCancel?.()) { cancelled = true; break; }
        if (excluded.has(entry.name)) { skippedDirs.push(path.join(dir, entry.name)); continue; }

        const full = path.join(dir, entry.name);

        if (entry.isSymbolicLink()) {
          // Never follow links — they can point anywhere (junctions on Windows too).
          skippedDirs.push(full);
          continue;
        }

        if (entry.isDirectory()) {
          if (isProtectedDir(full)) { skippedDirs.push(full); continue; }
          if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          const st = await fs.stat(full);
          const ext = path.extname(entry.name);
          const file: ScannedFile = {
            path: full,
            name: entry.name,
            ext,
            sizeBytes: st.size,
            mtimeMs: Math.round(st.mtimeMs),
            ageDays: Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 86_400_000)),
            isSymlink: false,
            kind: kindForExt(ext),
          };
          scanned += 1;
          files.push(file);
          opts.onFile?.(file);
          if (scanned % 25 === 0) {
            opts.onProgress?.(scanned, full, null);
            // Yield the event loop so cancel + UI stay responsive on huge trees.
            await new Promise((r) => setImmediate(r));
          }
        } catch (err) {
          errors.push({ path: full, error: readableFsError(err, full) });
        }
      }
      if (cancelled) break;
    }
    if (cancelled) break;
  }

  opts.onProgress?.(scanned, '', null);
  return { files, scanned, skippedDirs, errors, cancelled };
}

export function readableFsError(err: unknown, p: string): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `No permission to read "${p}" — skip it or run FileMind with access to this folder.`;
    case 'ENOENT':
      return `"${p}" no longer exists (it may have been moved or deleted).`;
    case 'EBUSY':
      return `"${p}" is busy (open in another program). Try again later.`;
    default:
      return `Could not read "${p}": ${String((err as Error)?.message ?? err)}`;
  }
}
