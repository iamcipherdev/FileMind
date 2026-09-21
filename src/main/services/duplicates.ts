import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DuplicateGroup } from '../../shared/types';

/**
 * Duplicate detection, two-pass:
 *   Pass 1 — group by exact byte size (cheap).
 *   Pass 2 — streaming SHA-256 only within size groups (never loads whole files).
 * No file is ever deleted here; the UI moves selected extras to a quarantine
 * folder so everything stays reversible.
 */
export async function findDuplicates(
  files: { path: string; name: string; sizeBytes: number; mtimeMs: number }[],
  shouldCancel?: () => boolean
): Promise<DuplicateGroup[]> {
  const bySize = new Map<number, typeof files>();
  for (const f of files) {
    if (f.sizeBytes === 0) continue; // empty files are trivially "duplicates" — not interesting
    const arr = bySize.get(f.sizeBytes) ?? [];
    arr.push(f);
    bySize.set(f.sizeBytes, arr);
  }

  const groups: DuplicateGroup[] = [];

  for (const [size, candidates] of bySize) {
    if (candidates.length < 2) continue;
    if (shouldCancel?.()) break;

    const byHash = new Map<string, typeof candidates>();
    for (const f of candidates) {
      let hash: string;
      try {
        hash = await sha256(f.path);
      } catch (err) {
        continue; // unreadable file — skip silently from dup detection, error surfaced elsewhere
      }
      const arr = byHash.get(hash) ?? [];
      arr.push(f);
      byHash.set(hash, arr);
    }

    for (const [hash, dupes] of byHash) {
      if (dupes.length >= 2) {
        groups.push({
          hash,
          sizeBytes: size,
          files: dupes
            .sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest = suggested keep
            .map((f) => ({ path: f.path, name: f.name, mtimeMs: f.mtimeMs })),
        });
      }
    }
  }

  groups.sort((a, b) => b.sizeBytes * (b.files.length - 1) - a.sizeBytes * (a.files.length - 1));
  return groups;
}

export function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

/** Suggested quarantine dir for duplicates (never deletes). */
export function quarantineDirFor(root: string): string {
  return path.join(root, 'FileMind Duplicates');
}
