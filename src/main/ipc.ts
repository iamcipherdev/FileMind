import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fsSync from 'node:fs';
import { Repository } from './db/repository';
import { openDatabase, Database } from './db/database';
import { TransactionEngine } from './services/transaction';
import { runSuggestPipeline } from './services/suggestEngine';
import { planForFile } from './services/planner';
import { createMlClassifier, MlClassifier } from './services/classifier';
import { findDuplicates, quarantineDirFor } from './services/duplicates';
import { parseRulePhrase } from './services/ruleParser';
import { validateRule } from './services/ruleEngine';
import { extractText } from './services/textExtract';
import { classifyDeterministic } from './services/deterministic';
import { generateDemoFiles } from './services/demoFiles';
import { FolderWatcher } from './services/watcher';
import crypto from 'node:crypto';

let db: Database | null = null;
let repo: Repository | null = null;
let ml: MlClassifier | null = null;
let engine: TransactionEngine | null = null;
let watcher: FolderWatcher | null = null;
let mainWindow: BrowserWindow | null = null;
let scanCancelFlag = false;

export function wireIpc(getWin: () => BrowserWindow | null): void {
  mainWindow = getWin();

  const send = (type: string, payload: unknown) => {
    mainWindow?.webContents.send('filemind:event', { type, payload });
  };

  const ensure = () => {
    if (!db) {
      db = openDatabase(path.join(app.getPath('userData'), 'filemind.db'));
      repo = new Repository(db);
      repo.ensureCategories();
    }
    return repo!;
  };

  const withRepo = <T>(fn: (r: Repository) => Promise<T> | T): Promise<T> => {
    const r = ensure();
    return Promise.resolve(fn(r));
  };

  // ---- scanning / analysis ----
  ipcMain.handle('scan:start', async (_e, roots: string[]) => {
    const r = ensure();
    scanCancelFlag = false;
    const settings = r.getSettings();
    if (!ml) ml = await createMlClassifier();
    const result = await runSuggestPipeline(roots, {
      getRules: async () => r.listRules(),
      ml,
      settings: {
        organizeRoots: settings.organizeFolders.length ? settings.organizeFolders : roots,
        excludedNames: settings.excludedNames,
        highThreshold: settings.highThreshold,
        reviewThreshold: settings.reviewThreshold,
        contentExtractEnabled: settings.contentExtractEnabled,
        maxContentBytes: settings.maxContentBytes,
      },
    }, {
      shouldCancel: () => scanCancelFlag,
      onProgress: (p) => send('scan-progress', p),
    });

    const batchId = result.suggestions[0]?.batchId ?? `batch-${Date.now().toString(36)}`;
    r.saveSuggestions(batchId, result.suggestions);
    send('scan-done', { scanned: result.scanned, suggestions: result.suggestions.length, cancelled: result.cancelled, batchId });
    return { batchId };
  });

  ipcMain.handle('scan:cancel', async () => { scanCancelFlag = true; });

  ipcMain.handle('suggestions:list', (_e, batchId?: string) => withRepo((r) => r.getSuggestions(batchId)));
  ipcMain.handle('suggestions:decide', (_e, ids: string[], decision: 'approved' | 'rejected') =>
    withRepo((r) => r.decideSuggestions(ids, decision)));
  ipcMain.handle('suggestions:classify', (_e, p: string) => Promise.resolve(classifyDeterministic({ name: path.basename(p), ext: path.extname(p), isSymlink: false })));

  // ---- apply / undo / history ----
  ipcMain.handle('suggestions:apply', async (_e, ids: string[]) => {
    const r = ensure();
    if (!engine) engine = new TransactionEngine(r);
    const suggestions = r.getSuggestionsByIds(ids);
    const settings = r.getSettings();
    const roots = settings.organizeFolders.length ? settings.organizeFolders : suggestions.map((s) => path.parse(s.fromPath).root);
    const result = await engine.apply(suggestions, roots);
    r.markSuggestionsStatus(ids.filter((id) => !result.failed.some((f) => f.path === suggestions.find((s) => s.id === id)?.filePath)), 'applied');
    send('apply-done', result);
    return result;
  });

  ipcMain.handle('undo:batch', async (_e, batchId: string) => {
    const r = ensure();
    if (!engine) engine = new TransactionEngine(r);
    const result = await engine.undo(batchId);
    send('undo-done', result);
    return result;
  });

  ipcMain.handle('history:list', () => withRepo((r) => r.listHistory()));
  ipcMain.handle('history:batch', (_e, batchId: string) => withRepo((r) => r.getBatchEntries(batchId)));

  // ---- rules ----
  ipcMain.handle('rules:list', () => withRepo((r) => r.listRules()));
  ipcMain.handle('rules:save', (_e, rule: import('../shared/types').Rule) => withRepo((r) => {
    const errors = validateRule(rule);
    if (errors.length > 0) throw new Error(errors.join(' '));
    r.saveRule(rule);
  }));
  ipcMain.handle('rules:delete', (_e, id: string) => withRepo((r) => r.deleteRule(id)));
  ipcMain.handle('rules:parse', (_e, text: string) => Promise.resolve(parseRulePhrase(text)));
  ipcMain.handle('rules:test', async (_e, rule: import('../shared/types').Rule, folder: string) => {
    const r = ensure();
    const settings = r.getSettings();
    const walk = await import('./services/scanner');
    const scan = await walk.scanFolders([folder], { excludedNames: settings.excludedNames, maxDepth: 6 });
    const matches: { path: string; to: string }[] = [];
    for (const f of scan.files) {
      const plan = planForFile({
        file: f,
        rules: [rule],
        ml: null,
        contentSnippet: null,
        settings: {
          highThreshold: settings.highThreshold,
          reviewThreshold: settings.reviewThreshold,
          organizeRoots: [folder],
        },
        exists: () => false,
      });
      if (plan.suggestion) matches.push({ path: f.path, to: plan.suggestion.toPath });
      if (matches.length >= 20) break;
    }
    return { matches: scan.files.length === 0 ? 0 : matches.length, samples: matches };
  });

  // ---- duplicates ----
  ipcMain.handle('duplicates:find', async (_e, roots: string[]) => {
    const r = ensure();
    const settings = r.getSettings();
    const walk = await import('./services/scanner');
    const scan = await walk.scanFolders(roots, { excludedNames: settings.excludedNames });
    return findDuplicates(scan.files.map((f) => ({ path: f.path, name: f.name, sizeBytes: f.sizeBytes, mtimeMs: f.mtimeMs })));
  });

  ipcMain.handle('duplicates:move', async (_e, paths: string[], root: string) => {
    const r = ensure();
    if (!engine) engine = new TransactionEngine(r);
    const qdir = quarantineDirFor(root);
    const suggestions = paths.map((p, i) => ({
      id: `dup-${i}`,
      filePath: p,
      action: 'move' as const,
      fromPath: p,
      toPath: path.join(qdir, path.basename(p)),
      reason: 'deterministic' as const,
      detail: 'Duplicate copy — moved to review folder (reversible, nothing deleted)',
      confidence: 1,
      tier: 'high' as const,
      batchId: '',
      status: 'pending' as const,
    }));
    const result = await engine.apply(suggestions, [root]);
    send('apply-done', result);
    return result;
  });

  // ---- settings / system ----
  ipcMain.handle('settings:get', () => withRepo((r) => r.getSettings()));
  ipcMain.handle('settings:set', (_e, s) => withRepo((r) => { r.setSettings(s); watcher?.update(s.watchedFolders); }));
  ipcMain.handle('dialog:pickFolder', async (_e, title: string) => {
    const out = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory'] });
    return out.canceled ? null : out.filePaths[0];
  });
  ipcMain.handle('ml:status', async () => {
    if (!ml) ml = await createMlClassifier();
    return ml.status();
  });
  ipcMain.handle('app:info', () => withRepo(() => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData'),
  })));
  ipcMain.handle('demo:generate', (_e, dir: string) => Promise.resolve(generateDemoFiles(dir)));
  ipcMain.handle('fs:openPath', (_e, p: string) => { shell.openPath(p); });
  ipcMain.handle('extract:preview', (_e, p: string) => withRepo(async (r) => {
    const s = r.getSettings();
    const out = await extractText(p, { enabled: true, maxBytes: s.maxContentBytes });
    return out ?? { text: '', truncated: false };
  }));

  // ---- watcher ----
  watcher = new FolderWatcher((p) => send('fs-change', p));
  ipcMain.handle('watcher:start', () => withRepo((r) => { watcher!.update(r.getSettings().watchedFolders); }));
}

export function ensureDbForTests(): { repo: Repository; db: Database } {
  const d = openDatabase(':memory:');
  const r = new Repository(d);
  r.ensureCategories();
  return { repo: r, db: d };
}

export function newBatchId(): string {
  return crypto.randomUUID();
}

export function hasMainWindow(): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed();
}

export function appDataDirName(): string {
  return fsSync === null ? '' : 'filemind';
}
