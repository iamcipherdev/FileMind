import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent } from '../shared/types';

/**
 * Preload — the only bridge between the sandboxed renderer and Node.
 * Exposes a typed, minimal API; no raw ipcRenderer, no Node primitives.
 */

const api = {
  startScan: (roots: string[]) => ipcRenderer.invoke('scan:start', roots),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  getSuggestions: (batchId?: string) => ipcRenderer.invoke('suggestions:list', batchId),
  decideSuggestions: (ids: string[], decision: 'approved' | 'rejected') =>
    ipcRenderer.invoke('suggestions:decide', ids, decision),
  applySuggestions: (ids: string[]) => ipcRenderer.invoke('suggestions:apply', ids),
  classifyFile: (p: string) => ipcRenderer.invoke('suggestions:classify', p),
  extractPreview: (p: string) => ipcRenderer.invoke('extract:preview', p),

  undoBatch: (batchId: string) => ipcRenderer.invoke('undo:batch', batchId),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getBatchEntries: (batchId: string) => ipcRenderer.invoke('history:batch', batchId),

  listRules: () => ipcRenderer.invoke('rules:list'),
  saveRule: (rule: unknown) => ipcRenderer.invoke('rules:save', rule),
  deleteRule: (id: string) => ipcRenderer.invoke('rules:delete', id),
  parseRulePhrase: (text: string) => ipcRenderer.invoke('rules:parse', text),
  testRule: async (rule: unknown, folder: string) => ipcRenderer.invoke('rules:test', rule, folder),

  findDuplicates: (roots: string[]) => ipcRenderer.invoke('duplicates:find', roots),
  moveDuplicates: (paths: string[], root: string) => ipcRenderer.invoke('duplicates:move', paths, root),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  pickFolder: (title: string) => ipcRenderer.invoke('dialog:pickFolder', title),
  getMlStatus: () => ipcRenderer.invoke('ml:status'),
  generateDemoFiles: (dir: string) => ipcRenderer.invoke('demo:generate', dir),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p: string) => ipcRenderer.invoke('fs:openPath', p),
  startWatcher: () => ipcRenderer.invoke('watcher:start'),
  notifyUiReady: () => ipcRenderer.invoke('ui:ready'),

  onEvent: (cb: (e: AppEvent) => void) => {
    const listener = (_: unknown, e: AppEvent) => cb(e);
    ipcRenderer.on('filemind:event', listener);
    return () => ipcRenderer.removeListener('filemind:event', listener);
  },
};

contextBridge.exposeInMainWorld('filemind', api);
