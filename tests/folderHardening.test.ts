import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FolderWatcher } from '../src/main/services/watcher';
import { isFileMindRuntimePath } from '../src/main/services/safety';
import { scanFolders } from '../src/main/services/scanner';
import { auditFolders, sanitizeSettingsFolders } from '../src/main/services/folderGuard';
import { makeTempDir } from './helpers';

/**
 * REGRESSION tests for the folder-selection startup bug family:
 *  - watchers refuse FileMind runtime dirs / protected dirs / missing dirs
 *  - a watcher is fully disposed before a new one starts (no duplicates)
 *  - the scanner never enters FileMind runtime dirs (TEST 8)
 *  - folder audit reports missing folders without throwing (TEST 3/4)
 */

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filemind-runtime-'));
const mkd = () => makeTempDir('filemind-t');
const created: string[] = [];

afterEach(() => {
  process.env.FILEMIND_TEST_RUNTIME_PATHS = undefined;
});

describe('isFileMindRuntimePath', () => {
  it('matches the runtime dir itself and everything inside it', () => {
    process.env.FILEMIND_TEST_RUNTIME_PATHS = runtimeDir;
    expect(isFileMindRuntimePath(runtimeDir)).toBe(true);
    expect(isFileMindRuntimePath(path.join(runtimeDir, 'filemind.db'))).toBe(true);
    expect(isFileMindRuntimePath(path.join(runtimeDir, 'logs', 'FileMind.log'))).toBe(true);
  });
  it('does not match unrelated folders', () => {
    process.env.FILEMIND_TEST_RUNTIME_PATHS = runtimeDir;
    const other = path.dirname(runtimeDir); // sibling-level, not inside
    expect(isFileMindRuntimePath(other)).toBe(false);
  });
  it('is false when no runtime paths are configured', () => {
    delete process.env.FILEMIND_TEST_RUNTIME_PATHS;
    delete process.env.FILEMIND_USERDATA_DIR;
    expect(isFileMindRuntimePath(runtimeDir)).toBe(false);
  });
});

// Diagnostic variants B/C disable the watcher by design; the disabled
// behavior is covered by diagnosticVariants.test.ts via env overrides.
const watchEnabled = !process.env.FILEMIND_DISABLE_WATCHER;
const watchDescribe = watchEnabled ? describe : describe.skip;

watchDescribe('FolderWatcher hardening', () => {
  it('refuses to watch FileMind runtime dirs and protected dirs', async () => {
    process.env.FILEMIND_TEST_RUNTIME_PATHS = runtimeDir;
    const dirA = mkd(); created.push(dirA);
    const w = new FolderWatcher(() => {});
    await w.update([runtimeDir, 'C:\\Windows', dirA]);
    // only dirA is actually watched:
    expect(w.isWatching([dirA])).toBe(true);
    expect(w.isWatching([runtimeDir])).toBe(false);
    await w.stop();
  });

  it('isWatching reflects the current list; re-updating the same list is a no-op', async () => {
    const dirA = mkd(); created.push(dirA);
    const w = new FolderWatcher(() => {});
    expect(w.isWatching([dirA])).toBe(false);
    await w.update([dirA]);
    expect(w.isWatching([dirA])).toBe(true);
    await w.update([dirA]); // must not throw / must not duplicate
    expect(w.isWatching([dirA])).toBe(true);
    await w.stop();
    expect(w.isWatching([dirA])).toBe(false); // stopped → not watching
  });

  it('stop() then update() replaces the watcher without leaking the old one', async () => {
    const dirA = mkd(); created.push(dirA);
    const dirB = mkd(); created.push(dirB);
    const w = new FolderWatcher(() => {});
    await w.update([dirA]);
    await w.update([dirB]);
    expect(w.isWatching([dirB])).toBe(true);
    expect(w.isWatching([dirA])).toBe(false);
    await w.stop();
  });

  it('filters missing folders out of the watch list', async () => {
    const dirA = mkd(); created.push(dirA);
    const missing = path.join(dirA, 'does-not-exist');
    const w = new FolderWatcher(() => {});
    await w.update([dirA, missing]);
    expect(w.isWatching([dirA])).toBe(true);
    await w.stop();
  });
});

describe('scanner runtime-path protection', () => {
  it('skips FileMind runtime dirs even when inside a scanned root (TEST 8)', async () => {
    process.env.FILEMIND_TEST_RUNTIME_PATHS = runtimeDir;
    const root = mkd(); created.push(root);
    fs.writeFileSync(path.join(root, 'normal.txt'), 'hello');
    const inside = path.join(root, 'runtime-clone');
    // simulate the runtime dir being located INSIDE the scanned root:
    process.env.FILEMIND_TEST_RUNTIME_PATHS = inside;
    fs.mkdirSync(inside, { recursive: true });
    fs.writeFileSync(path.join(inside, 'filemind.db'), 'db bytes');
    fs.writeFileSync(path.join(inside, 'secret.log'), 'log bytes');

    const scan = await scanFolders([root]);
    const names = scan.files.map((f) => f.name);
    expect(names).toContain('normal.txt');
    expect(names).not.toContain('filemind.db');
    expect(names).not.toContain('secret.log');
  });

  it('returns an error entry for an unreadable folder instead of crashing (TEST 3/4)', async () => {
    const missing = path.join(mkd(), 'vanished'); created.push(path.dirname(missing));
    const scan = await scanFolders([missing]);
    expect(scan.scanned).toBe(0);
    expect(scan.errors.length).toBe(1);
    expect(scan.errors[0].error).toMatch(/no longer exists/i);
  });
});

describe('folder audit + sanitize', () => {
  it('reports a missing saved folder as an issue, without throwing (TEST 3)', () => {
    const dirA = mkd(); created.push(dirA);
    const missing = path.join(dirA, 'deleted-folder');
    const issues = auditFolders({ organizeFolders: [dirA, missing], watchedFolders: [] } as never);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: missing, issue: 'missing' });
  });

  it('sanitize drops missing and protected folders from a save (TEST 4/8)', () => {
    const dirA = mkd(); created.push(dirA);
    const missing = path.join(dirA, 'nope');
    const s = {
      organizeFolders: [dirA, missing],
      watchedFolders: ['C:\\Windows'],
    } as never as Parameters<typeof sanitizeSettingsFolders>[0];
    const { rejected } = sanitizeSettingsFolders(s);
    expect(s.organizeFolders).toEqual([dirA]);
    expect(s.watchedFolders).toEqual([]);
    expect(rejected).toContain(missing);
    expect(rejected).toContain('C:\\Windows');
  });

  it('sanitize de-duplicates keep-list entries', () => {
    const dirA = mkd(); created.push(dirA);
    const s = { organizeFolders: [dirA, dirA], watchedFolders: [] } as never as Parameters<typeof sanitizeSettingsFolders>[0];
    sanitizeSettingsFolders(s);
    expect(s.organizeFolders).toEqual([dirA]);
  });
});
