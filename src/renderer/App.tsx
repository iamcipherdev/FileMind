import { useEffect, useState } from 'react';
import { Home, FolderCog, ScrollText, Copy, History as HistoryIcon, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import HomePage from './pages/Home';
import OrganizePage from './pages/Organize';
import RulesPage from './pages/Rules';
import DuplicatesPage from './pages/Duplicates';
import HistoryPage from './pages/History';
import SettingsPage from './pages/Settings';
import OnboardingPage from './pages/Onboarding';
import { api } from './lib/api';

type Page = 'home' | 'organize' | 'rules' | 'duplicates' | 'history' | 'settings';

const NAV: { id: Page; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'organize', label: 'Organize', icon: FolderCog },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'duplicates', label: 'Duplicates', icon: Copy },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setOnboarded(s.organizeFolders.length > 0);
    })();
  }, []);

  if (onboarded === null) {
    return <div className="flex h-full items-center justify-center text-ink-400 text-sm">Loading FileMind…</div>;
  }

  if (!onboarded) {
    return <OnboardingPage onDone={() => setOnboarded(true)} />;
  }

  return (
    <div className="flex h-full">
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
  );
}
