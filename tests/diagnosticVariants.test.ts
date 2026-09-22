import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { BOOTSTRAP_FILE_PATH } from '../src/main/bootstrap';
import { createMlClassifier } from '../src/main/services/classifier';
import { FolderWatcher } from '../src/main/services/watcher';

/**
 * Diagnostic-variant regression tests.
 *
 * The A/B/C isolation experiment is only meaningful if the toggles PREVENT
 * the actual initialization code from executing. These tests prove:
 *  - FILEMIND_DISABLE_ONNX=1  -> onnxruntime-node is never required and no
 *    session is ever created (ONNX_REQUIRE_STARTED never appears in the log).
 *  - FILEMIND_DISABLE_WATCHER=1 -> chokidar is never constructed
 *    (WATCHER_UPDATE_STARTED never appears in the log).
 */

const tail = (from: number) => fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8').slice(from);

afterEach(() => {
  delete process.env.FILEMIND_DISABLE_ONNX;
  delete process.env.FILEMIND_DISABLE_WATCHER;
});

describe('diagnostic variant gating', () => {
  it('ONNX disabled: require/session markers never appear, disable marker does', async () => {
    const before = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8').length;
    process.env.FILEMIND_DISABLE_ONNX = '1';
    const c = await createMlClassifier('/nonexistent-model-dir');
    const t = tail(before);
    expect(t).toContain('ONNX_DISABLED_BY_VARIANT');
    expect(t).not.toContain('ONNX_REQUIRE_STARTED');
    expect(t).not.toContain('ONNX_SESSION_STARTED');
    const s = c.status();
    expect(s.runtimeAvailable).toBe(false);
    expect(s.message).toMatch(/diagnostic/i);
  });

  it('watcher disabled: update() is a no-op, chokidar never constructed', async () => {
    const before = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8').length;
    process.env.FILEMIND_DISABLE_WATCHER = '1';
    const w = new FolderWatcher(() => {}, () => {}, () => {});
    await w.update(['C:\\some\\folder', '/tmp/another']);
    const t = tail(before);
    expect(t).toContain('WATCHER_DISABLED_BY_VARIANT');
    expect(t).not.toContain('WATCHER_UPDATE_STARTED');
    expect(t).not.toContain('WATCHER_UPDATE_SUCCESS');
    expect(w.isWatching([])).toBe(true); // nothing is being watched
  });
});
