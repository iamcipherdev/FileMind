import { app, BrowserWindow, Menu, screen } from 'electron';
import path from 'node:path';
import { wireIpc, shutdownServices } from './ipc';
import { initLogger, logger } from './logger';

/**
 * FileMind main process.
 *  - Creates the window, wires IPC, owns the DB connection.
 *  - All organizing logic lives in services/ so it is testable without Electron.
 *
 * Startup contract (see docs): a normal manual launch ALWAYS shows the main
 * window. Nothing may silently hide, minimize or quit the app. Any failure
 * during initialization is logged and degrades — never crashes the process.
 */

let win: BrowserWindow | null = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Single instance: relaunching FileMind while it runs must focus the existing
// window, not start a second process (which would contend for the SQLite db).
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.info('main', 'Another FileMind instance is already running — quitting this one.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logger.info('main', 'second-instance: focusing existing window.');
    restoreAndFocus();
  });
}

// ---------------------------------------------------------------------------
// Never let an async failure kill or zombie the app silently.
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

function createWindow(): BrowserWindow {
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

  // The window must ALWAYS end up visible. ready-to-show is the happy path;
  // did-finish-load and a watchdog cover renderers that paint late or never.
  aWindow.once('ready-to-show', () => {
    logger.info('window', 'ready-to-show -> show()');
    aWindow.show();
  });
  aWindow.webContents.once('did-finish-load', () => {
    logger.info('window', 'did-finish-load');
    setTimeout(() => {
      if (!aWindow.isDestroyed() && !aWindow.isVisible() && !aWindow.isMinimized()) {
        logger.warn('window', 'renderer finished loading but window still hidden — forcing show()');
        aWindow.show();
      }
    }, 750);
  });
  // Watchdog: even if load events misfire, the app must be visible.
  const watchdog = setTimeout(() => {
    if (!aWindow.isDestroyed() && !aWindow.isVisible()) {
      logger.warn('window', 'watchdog: window not shown within 5s — forcing show()');
      aWindow.show();
    }
  }, 5000);
  aWindow.once('closed', () => clearTimeout(watchdog));

  aWindow.webContents.on('render-process-gone', (_e, details) => {
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
  load.catch((err) => {
    logger.error('window', 'page load failed — forcing a visible error window', { message: (err as Error).message });
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

app.whenReady().then(() => {
  const logFile = initLogger(app.getPath('userData'));
  logger.info('main', 'app starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
    logFile,
  });

  // Runtime paths FileMind must never organize/watch (even when the user
  // picks a parent folder like C:\ or their home directory).
  process.env.FILEMIND_USERDATA_DIR = app.getPath('userData');
  process.env.FILEMIND_INSTALL_DIR = path.dirname(app.getPath('exe'));
  process.env.FILEMIND_TEMP_DIR = app.getPath('temp');

  Menu.setApplicationMenu(null);

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
});

app.on('window-all-closed', () => {
  logger.info('main', 'window-all-closed -> quitting');
  app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  logger.info('main', 'before-quit: shutting down services (scan, watcher, db)');
  // Give the shutdown a bounded, synchronous-best-effort pass; never hang quit.
  try {
    shutdownServices();
  } catch (err) {
    logger.error('main', 'shutdown error', { message: (err as Error).message });
  }
  // Do not preventDefault — quit proceeds after synchronous cleanup.
  void e;
});

app.on('quit', (_e, exitCode) => {
  logger.info('main', 'quit', { exitCode });
});
