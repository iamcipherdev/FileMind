import { useEffect, useState } from 'react';
import { FolderSearch, Sparkles, ShieldCheck, Undo2, ArrowRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../components/ui';
import type { HistoryEntry, MlStatus } from '@shared/types';

export default function HomePage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.getSettings>> | null>(null);
  const [ml, setMl] = useState<MlStatus | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, info, m, h] = await Promise.all([api.getSettings(), api.getAppInfo(), api.getMlStatus(), api.listHistory()]);
        setSettings(s);
        setMl(m);
        setHistory(h.slice(0, 5));
        void info;
      } catch (e) {
        // One failing backend call must not blank the page — show it and keep the app usable.
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const folders = settings?.organizeFolders ?? [];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-bold">Home</h1>
      <p className="mt-1 text-sm text-ink-500">
        Your files, organized locally — nothing ever leaves this computer.
      </p>

      {error && (
        <div className="card mt-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some information could not be loaded: {error}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button className="card flex flex-col items-start gap-2 p-5 text-left hover:border-ink-400 transition-colors" onClick={() => onNavigate('organize')}>
          <FolderSearch className="text-mint-600" size={22} />
          <div className="font-semibold">Organize a folder</div>
          <div className="text-xs text-ink-500">Scan → review suggestions → apply what you like. Fully reversible.</div>
        </button>
        <button className="card flex flex-col items-start gap-2 p-5 text-left hover:border-ink-400 transition-colors" onClick={() => onNavigate('rules')}>
          <Sparkles className="text-amber-500" size={22} />
          <div className="font-semibold">Write a rule</div>
          <div className="text-xs text-ink-500">Plain sentences like “move invoices to Documents/Finance when name contains invoice”.</div>
        </button>
        <button className="card flex flex-col items-start gap-2 p-5 text-left hover:border-ink-400 transition-colors" onClick={() => onNavigate('duplicates')}>
          <ShieldCheck className="text-sky-600" size={22} />
          <div className="font-semibold">Find duplicates</div>
          <div className="text-xs text-ink-500">SHA-256 exact matches. Extras are moved to a review folder — never deleted.</div>
        </button>
      </div>

      {/* Status row */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Organize folders</div>
          {folders.length === 0 ? (
            <div className="mt-2 text-sm text-ink-500">
              None yet. <button className="text-mint-700 underline" onClick={() => onNavigate('settings')}>Add folders in Settings</button>.
            </div>
          ) : (
            <ul className="mt-2 space-y-1">
              {folders.map((f) => (
                <li key={f} className="truncate text-sm font-medium" title={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Local ML model</div>
          <div className="mt-2 flex items-start gap-2 text-sm">
            <AlertTriangle size={16} className={ml?.modelInstalled ? 'text-mint-600' : 'text-amber-500'} />
            <span className="text-ink-600">{ml?.message ?? 'Checking…'}</span>
          </div>
        </div>
      </div>

      {/* Recent history */}
      <div className="card mt-6 p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Recent activity</div>
          <button className="text-xs text-mint-700 hover:underline" onClick={() => onNavigate('history')}>View all →</button>
        </div>
        {history.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-ink-500">
            <Undo2 size={15} /> Nothing organized yet. Every apply is undoable from History.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  {h.kind === 'apply' ? <ArrowRight size={14} className="text-mint-600" /> : <RefreshCw size={14} className="text-sky-600" />}
                  <span className="font-medium">{h.kind === 'apply' ? 'Applied' : 'Undone'}</span>
                  <span className="text-ink-500">{h.summary}</span>
                </span>
                <span className="text-xs text-ink-400">{formatDate(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
