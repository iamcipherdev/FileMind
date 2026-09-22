import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { Repository } from './db/repository';
import { openDatabaseResilient, Database } from './db/database';
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
import { auditFolders, sanitizeSettingsFolders } from './services/folderGuard';
import { logger } from './logger';
import { marker } from './bootstrap';
import crypto from 'node:crypto';
import type { FileMindSettings, FolderIssue } from '../shared/types';

let db: Database | null = null;
let dbRecoveredFromCorruption = false;
let repo: Repository | null = null;
let ml: MlClassifier | null = null;
let engine: TransactionEngine | null = null;
let watcher: FolderWatcher | null = null;
let scanCancelFlag = false;
let scanRunning = false;

/**
 * DB lifecycle. Opened lazily on first use, resilient against transient locks
 * and corruption (see openDatabaseResilient). Module-level so both IPC handlers
 * and the startup self-check share one connection.
 */
function ensureDb(): Repository {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'filemind.db');
    const res = openDatabaseResilient(dbPath, (msg: string) => logger.warn('db', msg));
    db = res.db;
    dbRecoveredFromCorruption = res.recovered;
    if (res.recovered) {
      logger.error('db', 'previous database was unreadable and has been quarantined; a fresh one was created', {
        quarantinedTo: res.quarantinedTo ?? null,
      });
    }
    repo = new Repository(db);
    repo.ensureCategories();
    logger.info('db', 'database ready', { path: dbPath, recovered: res.recovered });
  }
  return repo!;
}

export function wireIpc(getWin: () => BrowserWindow | null): void {
  // Store the ACCESSOR, not a snapshot: the window is created after wiring,
  // so a captured value would be null forever (the bug behind dead push
  // events and non-modal dialogs in v0.1.x).
  const mainWindow = () => getWin();

  const send = (type: string, payload: unknown) => {
    const w = mainWindow();
    if (w && !w.isDestroyed()) {
      try { w.webContents.send('filemind:event', { type, payload }); }
      catch (err) { logger.warn('ipc', `send(${type}) failed`, { message: (err as Error).message }); }
    }
  };

  /**
   * DB lifecycle: opened lazily via ensureDb() (module-level), resilient
   * against transient locks (antivirus, a previous instance still exiting)
   * and a corrupted database file (quarantine + recreate — see database.ts).
   */
  const ensure = ensureDb;

  const withRepo = <T>(fn: (r: Repository) => Promise<T> | T): Promise<T> => {
    const r = ensure();
    return Promise.resolve(fn(r));
  };

  /** Wrap every handler: one bad call must never crash the process or stay silent. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeHandle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('ipc', `handler failed: ${channel}`, { message });
        throw new Error(message); // surfaced to the invoking renderer call
      }
    });
  };

  // ---- scanning / analysis ----
  safeHandle('scan:start', async (_e: unknown, roots: string[]) => {
    const r = ensure();
    if (scanRunning) {
      logger.warn('scan', 'scan:start ignored — a scan is already running');
      throw new Error('A scan is already running. Wait for it to finish or press Cancel.');
    }
    if (!Array.isArray(roots) || roots.length === 0 || !roots.every((x) => typeof x === 'string')) {
      throw new Error('scan:start needs a non-empty list of folders.');
    }
    scanRunning = true;
    scanCancelFlag = false;
    try {
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
      logger.info('scan', 'scan finished', {
        scanned: result.scanned, suggestions: result.suggestions.length,
        errors: result.errors.length, cancelled: result.cancelled,
      });
      send('scan-done', { scanned: result.scanned, suggestions: result.suggestions.length, cancelled: result.cancelled, batchId });
      return { batchId };
    } finally {
      scanRunning = false;
    }
  });

  safeHandle('scan:cancel', async () => { scanCancelFlag = true; logger.info('scan', 'cancel requested'); });

  safeHandle('suggestions:list', (_e: unknown, batchId?: string) => withRepo((r) => r.getSuggestions(batchId)));
  safeHandle('suggestions:decide', (_e: unknown, ids: string[], decision: 'approved' | 'rejected') =>
    withRepo((r) => r.decideSuggestions(ids, decision)));
  safeHandle('suggestions:classify', (_e: unknown, p: string) => Promise.resolve(classifyDeterministic({ name: path.basename(p), ext: path.extname(p), isSymlink: false })));

  // ---- apply / undo / history ----
  safeHandle('suggestions:apply', async (_e: unknown, ids: string[]) => {
    const r = ensure();
    if (!engine) engine = new TransactionEngine(r);
    const suggestions = r.getSuggestionsByIds(ids);
    const settings = r.getSettings();
    const roots = settings.organizeFolders.length ? settings.organizeFolders : suggestions.map((s) => path.parse(s.fromPath).root);
    const result = await engine.apply(suggestions, roots);
    r.markSuggestionsStatus(ids.filter((id) => !result.failed.some((f) => f.path === suggestions.find((s) => s.id === id)?.filePath)), 'applied');
    logger.info('apply', 'batch applied', { applied: result.applied, failed: result.failed.length });
    send('apply-done', result);
    return result;
  });

  safeHandle('undo:batch', async (_e: unknown, batchId: string) => {
    const r = ensure();
    if (!engine) engine = new TransactionEngine(r);
    const result = await engine.undo(batchId);
    logger.info('undo', 'batch undone', { batchId, undone: result.undone, failed: result.failed.length });
    send('undo-done', result);
    return result;
  });

  safeHandle('history:list', () => withRepo((r) => r.listHistory()));
  safeHandle('history:batch', (_e: unknown, batchId: string) => withRepo((r) => r.getBatchEntries(batchId)));

  // ---- rules ----
  safeHandle('rules:list', () => withRepo((r) => r.listRules()));
  safeHandle('rules:save', (_e: unknown, rule: import('../shared/types').Rule) => withRepo((r) => {
    const errors = validateRule(rule);
    if (errors.length > 0) throw new Error(errors.join(' '));
    r.saveRule(rule);
  }));
  safeHandle('rules:delete', (_e: unknown, id: string) => withRepo((r) => r.deleteRule(id)));
  safeHandle('rules:parse', (_e: unknown, text: string) => Promise.resolve(parseRulePhrase(text)));
  safeHandle('rules:test', async (_e: unknown, rule: import('../shared/types').Rule, folder: string) => {
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
  safeHandle('duplicates:find', async (_e: unknown, roots: string[]) => {
    const r = ensure();
    const settings = r.getSettings();
    const walk = await import('./services/scanner');
    const scan = await walk.scanFolders(roots, { excludedNames: settings.excludedNames });
    return findDuplicates(scan.files.map((f) => ({ path: f.path, name: f.name, sizeBytes: f.sizeBytes, mtimeMs: f.mtimeMs })));
  });

  safeHandle('duplicates:move', async (_e: unknown, paths: string[], root: string) => {
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
  safeHandle('settings:get', () => withRepo((r) => {
    const s = r.getSettings();
    return { ...s, folderIssues: auditFolders(s) };
  }));

  safeHandle('settings:set', async (_e: unknown, s: FileMindSettings) => withRepo(async (r) => {
    const { rejected } = sanitizeSettingsFolders(s);
    r.setSettings(s);
    logger.info('settings', 'settings saved', {
      organizeFolders: s.organizeFolders,
      watchedFolders: s.watchedFolders,
      rejectedFolders: rejected,
    });
    // Watcher updates are awaited, caught and logged — a watcher problem must
    // never escape as an unhandled rejection and can never block the save.
    if (watcher) {
      try {
        await watcher.update(s.watchedFolders);
      } catch (err) {
        logger.error('watcher', 'update failed after settings save (continuing)', {
          message: (err as Error).message,
        });
      }
    }
    return { rejected };
  }));

  safeHandle('dialog:pickFolder', async (_e: unknown, title: string) => {
    const parent = mainWindow();
    const opts: Electron.OpenDialogOptions = { title: typeof title === 'string' ? title.slice(0, 120) : 'Pick a folder', properties: ['openDirectory'] };
    const out = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, opts)   // modal, correctly parented
      : await dialog.showOpenDialog(opts);          // window already gone — still functional
    return out.canceled ? null : out.filePaths[0];
  });

  safeHandle('ml:status', async () => {
    // FAITHFUL reproduction path (v0.1.2/v0.1.3 architecture): this currently
    // initializes the ONNX runtime in the main process. Marked so experiments
    // can prove exactly how far this path gets before any termination.
    marker('ML_STATUS_REQUESTED');
    if (!ml) ml = await createMlClassifier();
    return ml.status();
  });

  safeHandle('app:info', () => withRepo(() => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData'),
    logFilePath: logger.getLogFilePath(),
    dbRecoveredFromCorruption,
  })));

  safeHandle('demo:generate', (_e: unknown, dir: string) => Promise.resolve(generateDemoFiles(dir)));
  safeHandle('fs:openPath', (_e: unknown, p: string) => { shell.openPath(p); });
  safeHandle('extract:preview', (_e: unknown, p: string) => withRepo(async (r) => {
    const s = r.getSettings();
    const out = await extractText(p, { enabled: true, maxBytes: s.maxContentBytes });
    return out ?? { text: '', truncated: false };
  }));

  // ---- watcher ----
  // Created here but only STARTED once the UI is up (ui-ready below) or when
  // the user saves settings — never before the window exists.
  watcher = new FolderWatcher(
    (p) => send('fs-change', p),
    (msg, extra) => logger.warn('watcher', msg, extra),
    (msg, extra) => logger.info('watcher', msg, extra)
  );
  safeHandle('watcher:start', () => withRepo((r) => {
    watcher!.update(r.getSettings().watchedFolders);
  }));
  safeHandle('ui:ready', () => {
    logger.info('main', 'UI ready — starting background services');
    withRepo((r) => { watcher!.update(r.getSettings().watchedFolders); });
  });

  // Diagnostic/lifecycle marker from the renderer, forwarded to the
  // synchronous bootstrap log (survives even a native crash).
  safeHandle('app:marker', (_e: unknown, name: unknown) => {
    if (typeof name === 'string' && name.length > 0 && name.length <= 64 && /^[A-Z0-9_:-]+$/i.test(name)) {
      marker(name.toUpperCase());
    }
  });
}

/** Called once the renderer has painted — watchers must not run before the UI is safe. */
export function startServicesAfterUiReady(): void {
  try {
    if (watcher && repo) watcher.update(repo.getSettings().watchedFolders);
  } catch (err) {
    logger.warn('watcher', 'deferred start failed', { message: (err as Error).message });
  }
}

export interface StartupSelfCheck {
  settingsSummary: string;
  folderIssues: FolderIssue[];
  dbRecovered: boolean;
}

/**
 * Startup self-check for the bootstrap log (BOOTSTRAP 04-07, 13-15).
 * Pre-opens the database (settings/config live in SQLite), reads the saved
 * folders and audits them — every failure DEGRADES instead of throwing, so a
 * broken db/config/folder can no longer prevent the UI from opening.
 */
export function startupSelfCheck(): StartupSelfCheck {
  let recovered = false;
  let r: Repository;
  try {
    r = ensureDb();
    recovered = dbRecoveredFromCorruption;
  } catch (err) {
    logger.error('db', 'startup self-check could not open the database — continuing without it', {
      message: (err as Error).message,
    });
    return { settingsSummary: 'db-unavailable', folderIssues: [], dbRecovered: false };
  }
  try {
    const s = r.getSettings();
    const issues = auditFolders(s);
    logger.info('main', 'startup self-check: saved folders restored', {
      organizeFolders: s.organizeFolders.length,
      watchedFolders: s.watchedFolders.length,
      issues: issues.length,
    });
    return {
      settingsSummary: `organizeFolders=${s.organizeFolders.length} watchedFolders=${s.watchedFolders.length}`,
      folderIssues: issues,
      dbRecovered: recovered,
    };
  } catch (err) {
    logger.error('settings', 'startup self-check could not read settings — safe defaults will be used', {
      message: (err as Error).message,
    });
    return { settingsSummary: 'settings-unavailable', folderIssues: [], dbRecovered: recovered };
  }
}

/** Bounded, best-effort shutdown for before-quit (scan, watcher, db). */
export function shutdownServices(): void {
  scanCancelFlag = true;
  try { watcher?.stop(); } catch (err) { logger.warn('watcher', 'stop failed on quit', { message: (err as Error).message }); }
  watcher = null;
  try { repo?.close(); logger.info('db', 'database closed cleanly'); } catch (err) {
    logger.warn('db', 'close failed on quit', { message: (err as Error).message });
  }
  db = null;
  repo = null;
  logger.flush();
}

export function ensureDbForTests(): { repo: Repository; db: Database } {
  const d = openDatabaseResilient(':memory:').db;
  const r = new Repository(d);
  r.ensureCategories();
  return { repo: r, db: d };
}

export function newBatchId(): string {
  return crypto.randomUUID();
}
