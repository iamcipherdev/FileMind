import { useEffect, useState } from 'react';
import { Home, FolderCog, ScrollText, Copy, History as HistoryIcon, Settings as SettingsIcon, Sparkles, AlertTriangle } from 'lucide-react';
import HomePage from './pages/Home';
import OrganizePage from './pages/Organize';
import RulesPage from './pages/Rules';
import DuplicatesPage from './pages/Duplicates';
import HistoryPage from './pages/History';
import SettingsPage from './pages/Settings';
import OnboardingPage from './pages/Onboarding';
import { api } from './lib/api';
import type { FolderIssue } from '@shared/types';

type Page = 'home' | 'organize' | 'rules' | 'duplicates' | 'history' | 'settings';

const NAV: { id: Page; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'organize', label: 'Organize', icon: FolderCog },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'duplicates', label: 'Duplicates', icon: Copy },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const ISSUE_TEXT: Record<FolderIssue['issue'], string> = {
  missing: 'no longer exists (moved, renamed or deleted)',
  inaccessible: 'cannot be accessed (permissions or drive unavailable)',
  'not-a-folder': 'is not a folder',
  protected: 'is a protected system location FileMind never touches',
  error: 'could not be read',
};

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string>('');
  const [dbRecovered, setDbRecovered] = useState(false);
  const [folderIssues, setFolderIssues] = useState<FolderIssue[]>([]);
  const [showIssues, setShowIssues] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, info] = await Promise.all([api.getSettings(), api.getAppInfo()]);
        setOnboarded(s.organizeFolders.length > 0);
        setFolderIssues(s.folderIssues ?? []);
        setLogPath(info.logFilePath ?? '');
        setDbRecovered(info.dbRecoveredFromCorruption ?? false);
        // The UI is up: only now are background services (watcher) allowed to start.
        void api.notifyUiReady();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (onboarded === null) {
    if (loadError !== null) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-ink-950 px-6 text-center">
          <div className="text-sm font-semibold text-red-400">FileMind could not start</div>
          <div className="max-w-md font-mono text-xs leading-relaxed text-ink-400">{loadError}</div>
          {logPath && (
            <div className="max-w-md text-[11px] leading-relaxed text-ink-500">
              Details were written to <span className="font-mono">{logPath}</span>
            </div>
          )}
          <button
            onClick={() => { setLoadError(null); window.location.reload(); }}
            className="rounded-lg bg-ink-800 px-4 py-2 text-xs text-white transition-colors hover:bg-ink-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return <div className="flex h-full items-center justify-center text-ink-400 text-sm">Loading FileMind…</div>;
  }

  if (!onboarded) {
    return <OnboardingPage onDone={() => setOnboarded(true)} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Non-blocking warnings: broken folders / recovered database */}
      {(folderIssues.length > 0 || dbRecovered) && showIssues && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            {folderIssues.length > 0 && (
              <div>
                <b>Some saved folders are not usable right now:</b>{' '}
                <span className="break-all">
                  {folderIssues.map((f) => `${f.path} (${ISSUE_TEXT[f.issue] ?? f.issue})`).join('; ')}
                </span>
                . FileMind opened normally — those folders are paused until you pick a working one in Settings.
              </div>
            )}
            {dbRecovered && (
              <div className={folderIssues.length > 0 ? 'mt-1' : ''}>
                <b>FileMind repaired its local database.</b> The previous database file could not be read; it was kept
                aside (not deleted) and a fresh one was created. Your files on disk were never affected.
              </div>
            )}
          </div>
          <button className="shrink-0 text-amber-700 hover:underline" onClick={() => setShowIssues(false)}>dismiss</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-ink-200 bg-white">
          <div className="flex items-center gap-2 px-5 py-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-white">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-sm font-bold leading-none">FileMind</div>
              <div className="mt-0.5 text-[11px] text-ink-400">organized locally</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  page === id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="border-t border-ink-100 px-4 py-3 text-[11px] leading-relaxed text-ink-400">
            100% offline · nothing leaves this PC<br />Preview → approve → apply → undo
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {page === 'home' && <HomePage onNavigate={(p) => setPage(p as Page)} />}
          {page === 'organize' && <OrganizePage />}
          {page === 'rules' && <RulesPage />}
          {page === 'duplicates' && <DuplicatesPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage onOnboard={() => setOnboarded(false)} />}
        </main>
      </div>
    </div>
  );
}
