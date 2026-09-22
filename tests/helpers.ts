import fs from 'node:fs';
import path from 'node:path';

/**
 * Platform-portable temp dirs for tests.
 *
 * os.tmpdir() on Windows resolves INSIDE "...\AppData\Local\Temp\..." and
 * FileMind's own safety guards (isProtectedDir) correctly refuse any path
 * containing an "appdata" segment — so watcher/scanner/planner tests that
 * need a *usable* folder must create it OUTSIDE AppData. The repo-local
 * ".tmp-tests" directory has no protected segments on any platform.
 */
export function makeTempDir(prefix: string): string {
  const base = path.join(process.cwd(), '.tmp-tests');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}
