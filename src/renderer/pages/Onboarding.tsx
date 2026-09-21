import { useState } from 'react';
import { FolderPlus, Gauge, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

const STEPS = 3;

export default function OnboardingPage({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [folders, setFolders] = useState<string[]>([]);
  const [demoCreated, setDemoCreated] = useState<string | null>(null);

  const addFolder = async () => {
    const f = await api.pickFolder('Pick a folder FileMind may organize');
    if (f && !folders.includes(f)) setFolders([...folders, f]);
  };

  const makeDemo = async () => {
    const dir = await api.pickFolder('Pick where the FileMindDemo folder should be created');
    if (!dir) return;
    const out = await api.generateDemoFiles(dir + '/FileMindDemo');
    setDemoCreated(out.dir);
    setFolders([...folders, out.dir]);
  };

  const finish = async () => {
    const s = await api.getSettings();
    await api.setSettings({ ...s, organizeFolders: folders, watchedFolders: folders });
    onDone();
  };

  return (
    <div className="flex h-full items-center justify-center bg-ink-900 p-8">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-white"><Sparkles size={18} /></div>
          <div className="text-lg font-bold">Welcome to FileMind</div>
          <div className="ml-auto text-xs text-ink-400">step {step + 1} of {STEPS}</div>
        </div>

        {step === 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 font-semibold"><FolderPlus size={16} className="text-mint-600" /> Pick folders to organize</div>
            <p className="mt-2 text-sm text-ink-500">
              FileMind only ever moves files inside the folders you pick here. That is a hard boundary — not a suggestion.
            </p>
            <button className="btn-mint mt-4" onClick={addFolder}><FolderPlus size={14} /> Add a folder</button>
            <button className="btn-ghost mt-4" onClick={makeDemo}>…or generate a safe demo folder</button>
            {demoCreated && <div className="mt-2 text-xs text-mint-700">Demo corpus ready: {demoCreated}</div>}
            {folders.length > 0 && (
              <ul className="mt-3 space-y-1">
                {folders.map((f) => <li key={f} className="truncate rounded-lg bg-ink-50 px-3 py-2 text-sm">{f}</li>)}
              </ul>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 font-semibold"><Gauge size={16} className="text-amber-500" /> How confidence works</div>
            <ul className="mt-3 space-y-3 text-sm text-ink-600">
              <li><span className="badge bg-mint-100 text-mint-800">≥ 90%</span> Strong evidence (known file type, your rules). Preselected for you.</li>
              <li><span className="badge bg-amber-100 text-amber-800">70–89%</span> Good guess. Shown, but you decide.</li>
              <li><span className="badge bg-ink-100 text-ink-500">&lt; 70%</span> Too unsure. Listed under “Not sure”, never proposed.</li>
            </ul>
            <p className="mt-3 text-xs text-ink-400">You can tune these thresholds in Settings at any time.</p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-sky-600" /> The safety contract</div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-600">
              <li>Preview → approve → apply. Nothing moves on its own, ever.</li>
              <li>Every batch is fully undoable from History.</li>
              <li>No deletes. Duplicates go to a review folder.</li>
              <li>100% offline: no cloud, no accounts, no telemetry.</li>
            </ul>
          </div>
        )}

        <div className="mt-8 flex justify-end gap-2">
          {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS - 1 ? (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>Next <ArrowRight size={14} /></button>
          ) : (
            <button className="btn-mint" onClick={finish} disabled={folders.length === 0}>Start organizing</button>
          )}
        </div>
      </div>
    </div>
  );
}
