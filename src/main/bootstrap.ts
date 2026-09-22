import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * FileMind bootstrap instrumentation.
 *
 * This module must be the FIRST import in the main entrypoint — before user
 * settings, database, folders, tray, watchers, scanning, window or any native
 * module. It writes %TEMP%\FileMind-bootstrap.log synchronously (every line
 * flushed to disk immediately) so that even an instant process termination
 * leaves an exact record of the last startup step reached.
 *
 * Also installs the process-level fatal handlers (uncaughtException,
 * unhandledRejection, exit) so a fatal error is written here even when the
 * normal logging system has not initialized yet.
 */

const BOOTSTRAP_FILE = path.join(os.tmpdir(), 'FileMind-bootstrap.log');

let wrote = false;
/** Guard so a failing bootstrap write can never recurse or throw. */
function raw(line: string): void {
  try {
    const stamp = new Date().toISOString();
    const text = `${stamp} ${line}\n`;
    // appendFileSync + fsyncSync: the line is on disk BEFORE the next step runs.
    const fd = fs.openSync(BOOTSTRAP_FILE, 'a');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    wrote = true;
  } catch {
    // Nowhere to write (disk error, AV lock). Never throw from bootstrap.
  }
}

/** Ordered startup markers (user-facing names, logged verbatim). */
export const BOOTSTRAP_FILE_PATH = BOOTSTRAP_FILE;

/**
 * Experiment/lifecycle markers (HOME_MOUNTED, ML_STATUS_REQUESTED,
 * ONNX_REQUIRE_STARTED, ... PROCESS_EXIT). Written synchronously so a native
 * crash immediately after a marker leaves the marker on disk.
 */
export function marker(name: string): void {
  raw(`MARKER ${name}`);
}

export function bootstrapLog(line: string): void {
  raw(line);
}

/** Is the bootstrap log usable at all? (surfaced in diagnostics) */
export function bootstrapWritable(): boolean {
  return wrote;
}

/** Where fatal errors go when Electron's dialog module is not usable yet. */
export function bootstrapFatal(context: string, err: unknown, exitCode?: number): void {
  const e = err as { name?: string; message?: string; stack?: string; cause?: unknown };
  raw(`FATAL during ${context}`);
  raw(`  exception type : ${e?.name ?? typeof err}`);
  raw(`  error message  : ${e?.message ?? String(err)}`);
  if (e?.stack) raw(`  stack trace    : ${String(e.stack).split('\n').slice(0, 12).join(' | ')}`);
  if (e?.cause) {
    const c = e.cause as { name?: string; message?: string };
    raw(`  inner cause    : ${c?.name ?? ''} ${c?.message ?? String(c)}`);
  }
  if (exitCode !== undefined) raw(`  exit code      : ${exitCode}`);
}

/**
 * STEP 6 — production packaging audit. For every resource the packaged app
 * needs, log expected path / exists / readable so a packaging mistake is
 * provable from the log alone.
 */
export function logResource(name: string, expectedPath: string): void {
  let exists = false;
  let readable = false;
  let size = -1;
  try { exists = fs.existsSync(expectedPath); } catch { exists = false; }
  if (exists) {
    try {
      const fd = fs.openSync(expectedPath, 'r');
      try { size = fs.fstatSync(fd).size; } finally { fs.closeSync(fd); }
      readable = true;
    } catch { readable = false; }
  }
  raw(`RESOURCE: ${name}`);
  raw(`  expected path = ${expectedPath}`);
  raw(`  exists        = ${exists}`);
  raw(`  readable      = ${readable}${size >= 0 ? ` (size=${size})` : ''}`);
}

/**
 * Global fatal handlers — installed BEFORE anything else runs. Every handler
 * writes to the bootstrap log first (it always works), then to the normal
 * logger if that has been initialized.
 */
export function installBootstrapHandlers(): void {
  process.on('uncaughtException', (err) => {
    bootstrapFatal('uncaughtException (process stays alive)', err);
  });
  process.on('unhandledRejection', (reason) => {
    bootstrapFatal('unhandledRejection (process stays alive)', reason);
  });
  process.on('exit', (code) => {
    raw(`MARKER PROCESS_EXIT code=${code}`);
    raw(`BOOTSTRAP: process exit, code=${code}`);
  });
  // Renderer / child process deaths are fatal-ish signals for a windowed app:
  process.on('worker', () => { /* node worker — not used by FileMind */ });
}

/** STEP 1 — first line written by the entrypoint itself. */
export function bootstrapStarted(): void {
  raw('BOOTSTRAP: PROCESS STARTED');
  raw('BOOTSTRAP 01 - entrypoint reached');
}

export function bootstrapStep(step: string): void {
  raw(step);
}

export function bootstrapComplete(): void {
  raw('BOOTSTRAP COMPLETE');
}

// ---------------------------------------------------------------------------
// Module-load side effects: requiring THIS module is step 01. Because the
// compiled main.js emits `require('./bootstrap')` before every other require,
// even a failure while loading electron itself leaves a first log line — and
// its absence proves the process died before main.js executed at all.
// ---------------------------------------------------------------------------
bootstrapStarted();
installBootstrapHandlers();
