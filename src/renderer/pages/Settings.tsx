import { useEffect, useState } from 'react';
import { Plus, FolderOpen, Database, ShieldCheck, Bot } from 'lucide-react';
import { api } from '../lib/api';
import type { FileMindSettings, MlStatus } from '@shared/types';

export default function SettingsPage({ onOnboard }: { onOnboard: () => void }) {
  const [settings, setSettings] = useState<FileMindSettings | null>(null);
  const [ml, setMl] = useState<MlStatus | null>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.getAppInfo>> | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setSettings(await api.getSettings());
      setMl(await api.getMlStatus());
      setInfo(await api.getAppInfo());
    })();
  }, []);

  if (!settings) return <div className="p-8 text-sm text-ink-400">Loading…</div>;

  const update = (patch: Partial<FileMindSettings>) => setSettings({ ...settings, ...patch });

  const save = async () => {
    await api.setSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addFolder = async (key: 'organizeFolders' | 'watchedFolders') => {
    const f = await api.pickFolder(key === 'organizeFolders' ? 'Pick a folder FileMind may organize' : 'Pick a folder to watch for changes');
    if (!f) return;
    update({ [key]: [...settings[key], f] } as Partial<FileMindSettings>);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-ink-500">Everything is stored locally in {info?.dataDir ?? 'the app data folder'}.</p>

      {/* folders */}
      <section className="card mt-6 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><FolderOpen size={15} /> Organize folders</div>
          <button className="btn-ghost" onClick={() => addFolder('organizeFolders')}><Plus size={14} /> Add</button>
        </div>
        <p className="mt-1 text-xs text-ink-500">FileMind will only ever move files inside these folders — a hard safety boundary.</p>
        <ul className="mt-2 space-y-1">
          {settings.organizeFolders.length === 0 && <li className="text-sm text-ink-400">None yet.</li>}
          {settings.organizeFolders.map((f) => (
            <li key={f} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
              <span className="truncate">{f}</span>
              <button className="text-red-500 hover:underline" onClick={() => update({ organizeFolders: settings.organizeFolders.filter((x) => x !== f) })}>remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">Watched folders (change notifications)</div>
          <button className="btn-ghost" onClick={() => addFolder('watchedFolders')}><Plus size={14} /> Add</button>
        </div>
        <ul className="mt-2 space-y-1">
          {settings.watchedFolders.length === 0 && <li className="text-sm text-ink-400">Not watching anything. Watched folders ping you when files change — they are never organized automatically.</li>}
          {settings.watchedFolders.map((f) => (
            <li key={f} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
              <span className="truncate">{f}</span>
              <button className="text-red-500 hover:underline" onClick={() => update({ watchedFolders: settings.watchedFolders.filter((x) => x !== f) })}>remove</button>
            </li>
          ))}
        </ul>
      </section>

      {/* confidence */}
      <section className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} /> Confidence thresholds</div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="text-ink-600">High confidence ≥ <b>{Math.round(settings.highThreshold * 100)}%</b> (preselected)</span>
            <input type="range" min={50} max={100} value={settings.highThreshold * 100} onChange={(e) => update({ highThreshold: Number(e.target.value) / 100 })} className="mt-1 w-full accent-mint-600" />
          </label>
          <label className="text-sm">
            <span className="text-ink-600">Review threshold ≥ <b>{Math.round(settings.reviewThreshold * 100)}%</b> (shown, not preselected)</span>
            <input type="range" min={30} max={95} value={settings.reviewThreshold * 100} onChange={(e) => update({ reviewThreshold: Number(e.target.value) / 100 })} className="mt-1 w-full accent-amber-500" />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-mint-600" checked={!settings.autoApplyHigh} onChange={(e) => update({ autoApplyHigh: !e.target.checked })} />
          Always show me a preview before applying (recommended — nothing moves without your click)
        </label>
      </section>

      {/* content extraction */}
      <section className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Database size={15} /> Content-aware analysis</div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-mint-600"
            checked={settings.contentExtractEnabled}
            onChange={(e) => update({ contentExtractEnabled: e.target.checked })}
          />
          Read text from PDF / DOCX / TXT / MD / CSV files (up to {(settings.maxContentBytes / 1024 / 1024).toFixed(0)} MB) to power content rules
        </label>
        <p className="mt-2 text-xs text-ink-500">Text is processed in memory on this machine only — it is never uploaded, logged, or used to train anything.</p>
      </section>

      {/* ml */}
      <section className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Bot size={15} /> Local ML model</div>
        <div className="mt-2 text-sm text-ink-600">{ml?.message}</div>
        {ml?.modelPath && <div className="mt-1 truncate text-xs text-ink-400" title={ml.modelPath}>{ml.modelPath}</div>}
        <p className="mt-2 text-xs text-ink-500">Without a model, FileMind stays fully useful with rules + deterministic classification. See MODEL_CARD.md in the repo to train one honestly.</p>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <button className="btn-mint" onClick={save}>Save settings</button>
        {saved && <span className="text-sm text-mint-700">Saved ✓</span>}
        <button className="btn-ghost" onClick={onOnboard}>Re-run onboarding</button>
      </div>
    </div>
  );
}
