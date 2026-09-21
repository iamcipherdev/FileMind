import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { wireIpc } from './ipc';
import { FolderWatcher } from './services/watcher';

/**
 * FileMind main process.
 *  - Creates the window, wires IPC, owns the DB connection.
 *  - All organizing logic lives in services/ so it is testable without Electron.
 */

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
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

  Menu.setApplicationMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  wireIpc(() => win);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Watcher is created per-window lifecycle via IPC; keep a module-level handle here
// so a future multi-window setup shares one instance.
export let sharedWatcher: FolderWatcher | null = null;
export function setSharedWatcher(w: FolderWatcher): void { sharedWatcher = w; }
