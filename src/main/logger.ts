import fs from 'node:fs';
import path from 'node:path';

/**
 * FileMind local logger.
 *
 * Writes %APPDATA%/FileMind/logs/FileMind.log (rotated, 3 x 1 MB).
 * Logs lifecycle events, configuration loading, watcher/scanner/file-system
 * errors and uncaught exceptions — NEVER file contents or user file names
 * beyond what is already visible in the UI (paths the user picked).
 */

const LOG_DIR_NAME = 'logs';
const LOG_FILE_NAME = 'FileMind.log';
const MAX_BYTES = 1024 * 1024; // 1 MB per file
const MAX_FILES = 3;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let logDir: string | null = null;
let logFile: string | null = null;
let writeStream: fs.WriteStream | null = null;
let currentSize = 0;

export function initLogger(userDataDir: string): string {
  logDir = path.join(userDataDir, LOG_DIR_NAME);
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, LOG_FILE_NAME);
    currentSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    writeStream = fs.createWriteStream(logFile, { flags: 'a' });
    writeStream.on('error', () => { /* never crash on logging */ });
  } catch {
    // Disk/permission problems must never prevent the app from starting.
    logDir = null;
    logFile = null;
    writeStream = null;
  }
  return logFile ?? '';
}

export function getLogFilePath(): string {
  return logFile ?? '';
}

export function log(level: LogLevel, scope: string, message: string, extra?: unknown): void {
  const line = formatLine(level, scope, message, extra);

  // Always mirror to stdout/stderr — visible with --enable-logging and in dev.
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');

  if (!writeStream || !logFile) return;
  try {
    rotateIfNeeded(Buffer.byteLength(line));
    writeStream.write(line + '\n');
    currentSize += Buffer.byteLength(line) + 1;
  } catch {
    /* logging must never throw */
  }
}

function formatLine(level: LogLevel, scope: string, message: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  let out = `${ts} [${level.toUpperCase()}] [${scope}] ${message}`;
  if (extra !== undefined) {
    try {
      out += ` ${JSON.stringify(extra)}`;
    } catch {
      out += ` ${String(extra)}`;
    }
  }
  return out;
}

function rotateIfNeeded(incomingBytes: number): void {
  if (!logFile || currentSize + incomingBytes < MAX_BYTES) return;
  try {
    writeStream?.end();
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
      const to = `${logFile}.${i}`;
      if (fs.existsSync(from)) {
        try { fs.rmSync(to, { force: true }); } catch { /* best effort */ }
        try { fs.renameSync(from, to); } catch { /* best effort */ }
      }
    }
    writeStream = fs.createWriteStream(logFile, { flags: 'w' });
    writeStream.on('error', () => { /* ignore */ });
    currentSize = 0;
  } catch {
    /* keep running even if rotation fails */
  }
}

/** Convenience scoped loggers. */
export const logger = {
  debug: (scope: string, msg: string, extra?: unknown) => log('debug', scope, msg, extra),
  info: (scope: string, msg: string, extra?: unknown) => log('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => log('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => log('error', scope, msg, extra),
  getLogFilePath: () => getLogFilePath(),
  flush: () => {
    const ws = writeStream as unknown as { flush?: () => void } | null;
    try { ws?.flush?.(); } catch { /* ignore */ }
  },
};
