import path from 'node:path';
import fsSync from 'node:fs';
import { isProtectedDir, isFileMindRuntimePath } from './safety';
import type { FileMindSettings, FolderIssue } from '../../shared/types';

/**
 * Folder validation & health auditing. Electron-free so it is unit-testable.
 *
 * Contract:
 *  - Saving settings NEVER throws because of a bad folder; invalid entries are
 *    dropped and reported.
 *  - Saved folders that vanished / became unreadable / are protected are
 *    reported as issues so the UI can show a non-blocking warning.
 */

export interface SanitizeResult {
  rejected: string[];
}

/** Validate + normalize folder lists in-place. Invalid entries are dropped. */
export function sanitizeSettingsFolders(s: FileMindSettings): SanitizeResult {
  const rejected: string[] = [];
  const clean = (list: unknown): string[] => {
    if (!Array.isArray(list)) {
      rejected.push(...(typeof list === 'string' && list ? [list] : []));
      return [];
    }
    const out: string[] = [];
    for (const raw of list) {
      if (typeof raw !== 'string' || raw.trim() === '') { rejected.push(String(raw)); continue; }
      const p = path.resolve(raw);
      try {
        const st = fsSync.statSync(p);
        if (!st.isDirectory()) { rejected.push(raw); continue; }
      } catch {
        rejected.push(raw);
        continue;
      }
      if (isProtectedDir(p) || isFileMindRuntimePath(p)) { rejected.push(raw); continue; }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  };
  s.organizeFolders = clean(s.organizeFolders);
  s.watchedFolders = clean(s.watchedFolders);
  return { rejected };
}

/** Check every saved folder; return the ones that are currently not usable. */
export function auditFolders(s: FileMindSettings): FolderIssue[] {
  const issues: FolderIssue[] = [];
  const seen = new Set<string>();
  const check = (folder: string, role: 'organize' | 'watch') => {
    if (!folder || typeof folder !== 'string') return;
    const key = `${role}:${folder}`;
    if (seen.has(key)) return;
    seen.add(key);
    let st: fsSync.Stats | null = null;
    try {
      st = fsSync.statSync(folder);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      issues.push({
        path: folder,
        role,
        issue: code === 'ENOENT' ? 'missing' : (code === 'EACCES' || code === 'EPERM') ? 'inaccessible' : 'error',
      });
      return;
    }
    if (!st.isDirectory()) { issues.push({ path: folder, role, issue: 'not-a-folder' }); return; }
    if (isProtectedDir(folder) || isFileMindRuntimePath(folder)) {
      issues.push({ path: folder, role, issue: 'protected' });
    }
  };
  for (const f of s.organizeFolders ?? []) check(f, 'organize');
  for (const f of s.watchedFolders ?? []) check(f, 'watch');
  return issues;
}
