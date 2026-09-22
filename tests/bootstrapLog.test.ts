import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOOTSTRAP_FILE_PATH,
  bootstrapLog,
  bootstrapStep,
  bootstrapFatal,
  logResource,
} from '../src/main/bootstrap';

/**
 * Regression tests for the early-startup instrumentation.
 *
 * The bootstrap log is the proof-of-life record for the "process appears for
 * a fraction of a second, then disappears" class of bugs: every startup step
 * must land in %TEMP%\FileMind-bootstrap.log synchronously, and a fatal error
 * must be fully recorded (type, message, stack, cause) even before the normal
 * logger exists.
 */

describe('bootstrap log', () => {
  it('exists and starts with the process-started marker (written on module load)', () => {
    expect(BOOTSTRAP_FILE_PATH).toBe(path.join(os.tmpdir(), 'FileMind-bootstrap.log'));
    expect(fs.existsSync(BOOTSTRAP_FILE_PATH)).toBe(true);
    const content = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8');
    expect(content).toContain('BOOTSTRAP: PROCESS STARTED');
    expect(content).toContain('BOOTSTRAP 01 - entrypoint reached');
  });

  it('appends every step synchronously with flush', () => {
    const marker = `BOOTSTRAP test-step-${Date.now()}`;
    bootstrapStep(marker);
    const content = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8');
    expect(content).toContain(marker);
  });

  it('records a fatal error with type, message, stack and inner cause', () => {
    const err = new Error('bootstrap boom');
    (err as Error & { cause?: Error }).cause = new Error('root cause');
    bootstrapFatal('unit-test', err, 42);
    const content = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8');
    expect(content).toContain('FATAL during unit-test');
    expect(content).toContain('exception type : Error');
    expect(content).toContain('error message  : bootstrap boom');
    expect(content).toContain('stack trace');
    expect(content).toContain('inner cause    : Error root cause');
    expect(content).toContain('exit code      : 42');
  });

  it('logResource reports exists/readable for present and missing files', () => {
    const real = path.join(os.tmpdir(), `filemind-bootstrap-test-${Date.now()}.tmp`);
    fs.writeFileSync(real, 'x');
    logResource('present-file', real);
    logResource('missing-file', path.join(os.tmpdir(), `does-not-exist-${Date.now()}`));
    const content = fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8');
    const presentIdx = content.indexOf('RESOURCE: present-file');
    expect(presentIdx).toBeGreaterThan(-1);
    const presentBlock = content.slice(presentIdx, presentIdx + 400);
    expect(presentBlock).toContain('exists        = true');
    expect(presentBlock).toContain('readable      = true');
    const missingIdx = content.indexOf('RESOURCE: missing-file');
    const missingBlock = content.slice(missingIdx, missingIdx + 400);
    expect(missingBlock).toContain('exists        = false');
    fs.rmSync(real, { force: true });
  });

  it('plain lines are appended verbatim (bootstrapLog)', () => {
    const line = `plain line ${Date.now()}`;
    bootstrapLog(line);
    expect(fs.readFileSync(BOOTSTRAP_FILE_PATH, 'utf8')).toContain(line);
  });
});

describe('compiled main entry keeps bootstrap first', () => {
  const mainJs = path.join(__dirname, '..', 'dist-electron', 'main', 'main.js');

  it('emits require("./bootstrap") before electron/ipc requires', () => {
    if (!fs.existsSync(mainJs)) {
      console.warn('dist-electron/main/main.js not built yet — skipping order check');
      return;
    }
    const src = fs.readFileSync(mainJs, 'utf8');
    const iBootstrap = src.indexOf('require("./bootstrap")');
    const iElectron = src.indexOf('require("electron")');
    const iIpc = src.indexOf('require("./ipc")');
    expect(iBootstrap).toBeGreaterThan(-1);
    expect(iBootstrap).toBeLessThan(iElectron);
    expect(iBootstrap).toBeLessThan(iIpc);
  });
});
