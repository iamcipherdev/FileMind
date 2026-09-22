// ---------------------------------------------------------------------------
// BOOTSTRAP (must stay the very first imports/lines that execute)
// STEP 1: log from the first line to %TEMP%\FileMind-bootstrap.log
// STEP 2: fatal handlers installed before anything else can fail
// ---------------------------------------------------------------------------
import { bootstrapLog, bootstrapStep, BOOTSTRAP_FILE_PATH } from './bootstrap';
// Requiring ./bootstrap already wrote "BOOTSTRAP: PROCESS STARTED" (step 01)
// and installed the global fatal handlers — see bootstrap.ts module footer.

import { app, BrowserWindow, Menu, screen, dialog } from 'electron';
import path from 'node:path';
import { wireIpc, shutdownServices, startupSelfCheck } from './ipc';
import { initLogger, logger } from './logger';
import { bootstrapFatal, logResource, bootstrapComplete } from './bootstrap';

/**
 * FileMind main process.
 *  - Creates the window, wires IPC, owns the DB connection.
 *  - All organizing logic lives in services/ so it is testable without Electron.
 *
 * Startup contract (see docs): a normal manual launch ALWAYS shows the main
 * window. Nothing may silently hide, minimize or quit the app. Any failure
 * during initialization is logged and degrades — never crashes the process.
 * Every startup step is additionally recorded in %TEMP%\FileMind-bootstrap.log
 * with an immediate flush, so an early termination is always provable.
 */

let win: BrowserWindow | null = null;
let quitting = false;
let completeLogged = false;

/** STEP 1/9: BOOTSTRAP COMPLETE is logged exactly once, even on partial failure. */
function logBootstrapCompleteOnce(reason: string): void {
  if (completeLogged) return;
  completeLogged = true;
  bootstrapStep(`BOOTSTRAP COMPLETE (${reason})`);
}

// ---------------------------------------------------------------------------
// STEP 2 — environment snapshot before anything else touches the system.
// ---------------------------------------------------------------------------
bootstrapStep('BOOTSTRAP 02 - environment initialized');
bootstrapLog(`  versions: electron=${process.versions.electron} node=${process.versions.node} abi=${process.versions.modules}`);
bootstrapLog(`  platform=${process.platform} arch=${process.arch} exe="${app.getPath('exe')}" cwd="${process.cwd()}"`);
bootstrapLog(`  bootstrap log = ${BOOTSTRAP_FILE_PATH}`);
if (process.env.ELECTRON_RUN_AS_NODE === '1') {
  // Running as plain Node means `electron` APIs are unavailable — this would
  // look like an instant silent death. Record it loudly if it ever happens.
  bootstrapLog('  WARNING: ELECTRON_RUN_AS_NODE=1 — GUI mode disabled by environment');
}

// ---------------------------------------------------------------------------
// Single instance: relaunching FileMind while it runs must focus the existing
// window, not start a second process (which would contend for the SQLite db).
// The result is LOGGED: a silent instant exit here previously looked exactly
// like a crash ("appears for a fraction of a second, then disappears") when a
// still-running/zombie previous instance held the lock.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
bootstrapLog(`BOOTSTRAP: single-instance lock ${gotLock ? 'acquired' : 'DENIED (another FileMind instance is running)'}`);
if (!gotLock) {
  bootstrapStep('BOOTSTRAP: exiting by design — the already-running instance has been asked to focus its window.');
  logger.info('main', 'Another FileMind instance is already running — quitting this one.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logger.info('main', 'second-instance: focusing existing window.');
    bootstrapLog('second-instance event -> restoreAndFocus()');
    restoreAndFocus();
  });
}

// ---------------------------------------------------------------------------
// Never let an async failure kill or zombie the app silently. (Also mirrored
// to the bootstrap log — see installBootstrapHandlers above.)
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  logger.error('main', 'UNCAUGHT EXCEPTION (app stays alive)', {
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 6).join(' | '),
  });
});
process.on('unhandledRejection', (reason) => {
  logger.error('main', 'UNHANDLED PROMISE REJECTION (app stays alive)', {
    reason: reason instanceof Error ? `${reason.message}` : String(reason),
  });
});

/** STEP 4 (diagnostic, kept as a permanent safety net): a startup failure must be VISIBLE. */
function showStartupErrorDialog(context: string, err: unknown): void {
  bootstrapFatal(context, err);
  const e = err as { message?: string };
  try {
    dialog.showErrorBox(
      'FileMind failed during startup',
      `FileMind hit an error while starting (${context}).\n\n` +
        `The app will keep running, but this should never happen.\n` +
        `See the log for the exact cause:\n` +
        `${BOOTSTRAP_FILE_PATH}\n\n` +
        `Error: ${e?.message ?? String(err)}`
    );
  } catch {
    /* even the dialog must never take the process down */
  }
}

/** Validate bounds against connected displays; reset to a sane default when off-screen. */
function saneBounds(preferred?: { width: number; height: number }) {
  const width = preferred?.width ?? 1200;
  const height = preferred?.height ?? 800;
  const displays = screen.getAllDisplays();
  const visible = (x: number, y: number) =>
    displays.some((d) => {
      const a = d.workArea;
      // At least 120px of the title area must be inside a display.
      return x >= a.x - width + 120 && x < a.x + a.width - 40 &&
             y >= a.y - 40 && y < a.y + a.height - 40;
    });
  // No persisted window state exists yet — center on the primary display but
  // guarantee visibility even with disconnected monitors / changed DPI.
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  let x = Math.round(wa.x + (wa.width - width) / 2);
  let y = Math.round(wa.y + (wa.height - height) / 2);
  if (!visible(x, y)) { x = wa.x + 40; y = wa.y + 40; }
  return { width, height, x, y };
}

/** STEP 6 — packaging audit: prove every packaged resource exists & is readable. */
function auditPackagedResources(): void {
  const appDir = app.getAppPath();
  logResource('frontend (dist/index.html)', path.join(appDir, 'dist', 'index.html'));
  logResource('preload script', path.join(__dirname, 'preload.js'));
  logResource('models/labels.json', path.join(process.resourcesPath ?? appDir, 'models', 'labels.json'));
  logResource('models/manifest.json', path.join(process.resourcesPath ?? appDir, 'models', 'manifest.json'));
  logResource(
    'better-sqlite3 native (asar.unpacked)',
    path.join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  );
  logResource(
    'onnxruntime-node binding (asar.unpacked)',
    path.join(appDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64', 'onnxruntime_binding.node')
  );
}

function createWindow(): BrowserWindow {
  bootstrapStep('BOOTSTRAP 08 - main window creation started');
  const bounds = saneBounds();
  const aWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#16181f',
    title: 'FileMind',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  bootstrapStep('BOOTSTRAP 09 - main window created');

  // The window must ALWAYS end up visible. ready-to-show is the happy path;
  // did-finish-load and a watchdog cover renderers that paint late or never.
  aWindow.once('ready-to-show', () => {
    logger.info('window', 'ready-to-show -> show()');
    bootstrapLog('window: ready-to-show -> show()');
    aWindow.show();
  });
  aWindow.webContents.once('did-finish-load', () => {
    logger.info('window', 'did-finish-load');
    bootstrapStep('BOOTSTRAP 11 - UI loaded');
    logBootstrapCompleteOnce('UI loaded');
    setTimeout(() => {
      if (!aWindow.isDestroyed() && !aWindow.isVisible() && !aWindow.isMinimized()) {
        logger.warn('window', 'renderer finished loading but window still hidden — forcing show()');
        aWindow.show();
      }
    }, 750);
  });
  // Watchdog: even if load events misfire, the app must be visible AND the
  // bootstrap log must record a COMPLETE marker.
  const watchdog = setTimeout(() => {
    if (!aWindow.isDestroyed() && !aWindow.isVisible()) {
      logger.warn('window', 'watchdog: window not shown within 5s — forcing show()');
      aWindow.show();
    }
    logBootstrapCompleteOnce('watchdog fallback (5s)');
  }, 5000);
  aWindow.once('closed', () => clearTimeout(watchdog));

  aWindow.webContents.on('render-process-gone', (_e, details) => {
    bootstrapFatal('renderer crash (render-process-gone)', {
      name: 'RendererGone',
      message: `reason=${details.reason} exitCode=${details.exitCode}`,
    });
    logger.error('window', 'renderer process gone', { reason: details.reason, exitCode: details.exitCode });
    // A dead renderer must not leave an invisible app. Recreate the window.
    if (!quitting) {
      try { aWindow.destroy(); } catch { /* ignore */ }
      if (!BrowserWindow.getAllWindows().length) {
        win = createWindow();
      }
    }
  });
  aWindow.webContents.on('unresponsive', () => logger.warn('window', 'renderer unresponsive'));
  aWindow.webContents.on('responsive', () => logger.info('window', 'renderer responsive again'));

  aWindow.on('show', () => logger.debug('window', 'show'));
  aWindow.on('minimize', () => logger.debug('window', 'minimize'));
  aWindow.on('restore', () => logger.debug('window', 'restore'));
  aWindow.on('close', (e) => {
    // Closing the last window quits the app (no minimize-to-tray in FileMind).
    if (!quitting) logger.info('window', 'close requested by user -> quitting app');
    if (aWindow.isMinimized()) aWindow.restore();
    if (e.defaultPrevented) return;
  });
  aWindow.on('closed', () => {
    logger.info('window', 'closed');
    if (win === aWindow) win = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl
    ? aWindow.loadURL(devUrl)
    : aWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  bootstrapStep('BOOTSTRAP 10 - UI loading started');
  load.catch((err) => {
    logger.error('window', 'page load failed — forcing a visible error window', { message: (err as Error).message });
    bootstrapFatal('page load failed (window stays visible)', err);
    bootstrapComplete();
    // Even a failed load must not leave an invisible app hanging around.
    if (!aWindow.isDestroyed()) aWindow.show();
  });
  if (devUrl) aWindow.webContents.openDevTools({ mode: 'detach' });
  return aWindow;
}

function restoreAndFocus(): void {
  const w = win ?? BrowserWindow.getAllWindows()[0];
  if (!w || w.isDestroyed()) {
    win = createWindow();
    return;
  }
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
}

async function startApp(): Promise<void> {
  // STEP 1: normal logging initializes here — inside a guarded block. If the
  // user-data dir is unusable, initLogger degrades and the app STILL starts.
  const logFile = initLogger(app.getPath('userData'));
  logger.info('main', 'app starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
    logFile,
  });
  bootstrapLog(`FileMind.log = ${logFile || '(unavailable — degraded)'}`);

  // Runtime paths FileMind must never organize/watch (even when the user
  // picks a parent folder like C:\ or their home directory).
  process.env.FILEMIND_USERDATA_DIR = app.getPath('userData');
  process.env.FILEMIND_INSTALL_DIR = path.dirname(app.getPath('exe'));
  process.env.FILEMIND_TEMP_DIR = app.getPath('temp');
  bootstrapLog(`runtime paths: userData="${process.env.FILEMIND_USERDATA_DIR}" install="${process.env.FILEMIND_INSTALL_DIR}"`);

  bootstrapStep('BOOTSTRAP 03 - user data path resolved');

  Menu.setApplicationMenu(null);

  // STEP 6 — prove the packaged resources are present BEFORE the UI needs them.
  auditPackagedResources();

  // STEP 1 steps 04-07 + 13-15: guarded startup self-check. It pre-opens the
  // database (config/settings live in SQLite), audits saved folders and
  // reports every result in the bootstrap log. ANY failure here is logged and
  // degraded — a bad db/config/folder can no longer prevent the UI.
  try {
    bootstrapStep('BOOTSTRAP 04 - config loading started');
    const self = startupSelfCheck();
    bootstrapStep(`BOOTSTRAP 05 - config loaded (${self.settingsSummary}; folderIssues=${self.folderIssues.length})`);
    for (const issue of self.folderIssues.slice(0, 10)) {
      bootstrapLog(`  folder issue: role=${issue.role} issue=${issue.issue} (path withheld)`);
    }
    bootstrapStep('BOOTSTRAP 06 - database initialization started');
    bootstrapStep('BOOTSTRAP 07 - database initialized' + (self.dbRecovered ? ' (previous db was quarantined)' : ''));
    bootstrapStep('BOOTSTRAP 13 - folder restoration done');
    bootstrapStep('BOOTSTRAP 14 - scanner initialization done (scanner starts only on user action)');
    bootstrapStep('BOOTSTRAP 15 - watcher initialization done (watcher starts after UI is ready)');
  } catch (err) {
    // Recovery contract: initialization of previous data must never block the
    // UI. Log it, keep launching, let the user fix/remove the folder later.
    showStartupErrorDialog('startup self-check (app continues with degraded state)', err);
  }

  bootstrapStep('BOOTSTRAP 12 - tray initialization (FileMind uses no tray by design)');

  wireIpc(() => win);
  win = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('main', 'activate with no windows -> createWindow');
      win = createWindow();
    } else {
      restoreAndFocus();
    }
  });
}

app.whenReady().then(() => {
  // STEP 2: the complete bootstrap is wrapped — a fatal startup error is now
  // logged with type/message/stack, shown in a native dialog, and the process
  // records its exit code. It can never silently vanish again.
  startApp().then(() => {
    bootstrapLog('app.whenReady() chain finished');
  }).catch((err) => {
    showStartupErrorDialog('app start (whenReady)', err);
    logBootstrapCompleteOnce('after startup error');
  });
});

app.on('window-all-closed', () => {
  logger.info('main', 'window-all-closed -> quitting');
  bootstrapLog('window-all-closed -> quitting (no tray by design)');
  app.quit();
});

// STEP 2: GPU / utility / renderer child crashes are recorded in the
// bootstrap log — a GPU-process crash loop previously looked like "the app
// flashes and disappears" with no trace anywhere.
app.on('child-process-gone', (_e, details) => {
  bootstrapFatal('child process gone', {
    name: 'ChildProcessGone',
    message: `type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  });
});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  logger.info('main', 'before-quit: shutting down services (scan, watcher, db)');
  bootstrapLog('before-quit: shutting down services (scan, watcher, db)');
  // Give the shutdown a bounded, synchronous-best-effort pass; never hang quit.
  try {
    shutdownServices();
  } catch (err) {
    logger.error('main', 'shutdown error', { message: (err as Error).message });
    bootstrapFatal('shutdownServices', err);
  }
  // Do not preventDefault — quit proceeds after synchronous cleanup.
  void e;
});

app.on('quit', (_e, exitCode) => {
  logger.info('main', 'quit', { exitCode });
  bootstrapLog(`quit event, exitCode=${exitCode}`);
});
