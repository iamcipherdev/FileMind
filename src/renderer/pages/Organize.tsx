import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, CheckCheck, Undo2, Eye, ShieldAlert, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { TierBadge, Pct, shortenPath } from '../components/ui';
import type { Suggestion, ScanProgress, ApplyResult } from '@shared/types';

type Filter = 'all' | 'high' | 'review' | 'low';

export default function OrganizePage() {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.getSettings>> | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      setSelectedRoot(s.organizeFolders[0] ?? '');
      const pending = await api.getSuggestions();
      setSuggestions(pending);
      setApproved(new Set(pending.filter((p) => p.tier === 'high' && p.status === 'approved').map((p) => p.id)));
    })();
  }, []);

  const onEvent = useCallback((e: { type: string; payload: unknown }) => {
    if (e.type === 'scan-progress') setProgress(e.payload as ScanProgress);
    if (e.type === 'scan-done') {
      setScanning(false);
      (async () => {
        const sugg = await api.getSuggestions();
        setSuggestions(sugg);
        setApproved(new Set(sugg.filter((s) => s.tier === 'high').map((s) => s.id)));
      })();
    }
    if (e.type === 'apply-done') {
      setResult(e.payload as ApplyResult);
      (async () => {
        const sugg = await api.getSuggestions();
        setSuggestions(sugg);
      })();
    }
  }, []);

  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  useEffect(() => api.onEvent((e) => eventRef.current(e)), []);

  const startScan = async () => {
    if (!selectedRoot) return;
    setScanning(true);
    setResult(null);
    setSuggestions([]);
    setProgress({ scanned: 0, totalEstimate: null, currentPath: '', done: false });
    await api.startScan([selectedRoot]);
  };

  const toggle = (id: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const apply = async () => {
    setBusy(true);
    const ids = [...approved];
    await api.decideSuggestions(ids.filter((id) => suggestions.find((s) => s.id === id)?.status === 'pending'), 'approved');
    await api.applySuggestions(ids);
    setBusy(false);
    setApproved(new Set());
  };

  const reject = async (id: string) => {
    await api.decideSuggestions([id], 'rejected');
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    await api.undoBatch(batchId);
    setBusy(false);
    setResult(null);
  };

  const openPreview = async (path: string) => {
    const out = await api.extractPreview(path);
    setPreview({ path, ...out });
  };

  const visible = suggestions.filter((s) => filter === 'all' || s.tier === filter);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organize</h1>
          <p className="mt-1 text-sm text-ink-500">Scan a folder, review suggestions with confidence, apply what you approve. Undo anytime.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-72" value={selectedRoot} onChange={(e) => setSelectedRoot(e.target.value)}>
            {(settings?.organizeFolders ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
            {(settings?.organizeFolders ?? []).length === 0 && <option value="">Add an organize folder in Settings first</option>}
          </select>
          {scanning ? (
            <button className="btn-danger" onClick={() => api.cancelScan()}>
              <Square size={14} /> Cancel
            </button>
          ) : (
            <button className="btn-mint" disabled={!selectedRoot} onClick={startScan}>
              <Play size={14} /> Scan & suggest
            </button>
          )}
        </div>
      </div>

      {/* progress */}
      {scanning && progress && (
        <div className="card mt-4 flex items-center gap-3 p-4 text-sm">
          <Loader2 className="animate-spin text-mint-600" size={16} />
          <div className="flex-1">
            <div className="font-medium">Scanning… {progress.scanned} files</div>
            <div className="truncate text-xs text-ink-400">{shortenPath(progress.currentPath, 90)}</div>
          </div>
        </div>
      )}

      {/* last apply result */}
      {result && (
        <div className="card mt-4 flex items-center justify-between border-mint-200 bg-mint-50 p-4 text-sm">
          <div>
            <div className="font-semibold text-mint-800">Applied {result.applied} change{result.applied === 1 ? '' : 's'}</div>
            {result.failed.length > 0 && (
              <div className="mt-1 text-amber-700">{result.failed.length} failed: {result.failed[0].error}</div>
            )}
          </div>
          <button className="btn-primary" disabled={busy} onClick={() => undo(result.batchId)}>
            <Undo2 size={14} /> Undo all
          </button>
        </div>
      )}

      {/* filters */}
      {suggestions.length > 0 && (
        <div className="mt-5 flex items-center gap-2 text-sm">
          {(['all', 'high', 'review', 'low'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 ${filter === f ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 border border-ink-200'}`}
            >
              {f === 'all' ? 'All' : f === 'high' ? 'High' : f === 'review' ? 'Needs review' : 'Not sure'} (
              {f === 'all' ? suggestions.length : suggestions.filter((s) => s.tier === f).length})
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-400">{approved.size} selected</span>
          <button className="btn-mint" disabled={approved.size === 0 || busy} onClick={apply}>
            <CheckCheck size={14} /> Apply selected
          </button>
        </div>
      )}

      {/* suggestion list */}
      <div className="mt-4 space-y-2">
        {visible.length === 0 && !scanning && suggestions.length === 0 && (
          <div className="card p-8 text-center text-sm text-ink-500">
            Nothing suggested yet. Pick a folder above and hit <b>Scan &amp; suggest</b>.
            FileMind only proposes changes it is confident about — low-confidence files are listed under “Not sure” but never preselected.
          </div>
        )}
        {visible.map((s) => (
          <div key={s.id} className={`card flex items-center gap-4 p-4 ${approved.has(s.id) ? 'ring-1 ring-mint-400' : ''}`}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-mint-600"
              checked={approved.has(s.id)}
              onChange={() => toggle(s.id)}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" title={s.fromPath}>{s.filePath.split(/[\\/]/).pop()}</div>
              <div className="truncate text-xs text-ink-400" title={s.toPath}>
                {s.action === 'move' ? '→ ' : '✎ '}{shortenPath(s.toPath, 80)}
              </div>
              <div className="mt-1 text-xs text-ink-500">{s.detail}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <TierBadge tier={s.tier} />
              <span className="text-xs text-ink-400"><Pct v={s.confidence} /> confidence</span>
            </div>
            <button className="btn-ghost" title="Preview text content" onClick={() => openPreview(s.filePath)}>
              <Eye size={15} />
            </button>
            <button className="btn-ghost text-red-600" title="Not this — reject suggestion" onClick={() => reject(s.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {filter === 'low' && visible.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          These files did not pass the confidence threshold, so FileMind has no idea where they belong. Nothing here is preselected — you decide.
        </div>
      )}

      {/* preview drawer */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setPreview(null)}>
          <div className="h-full w-[420px] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="truncate text-sm font-bold">{preview.path.split(/[\\/]/).pop()}</h3>
              <button className="btn-ghost" onClick={() => setPreview(null)}>✕</button>
            </div>
            <p className="mt-1 break-all text-xs text-ink-400">{preview.path}</p>
            <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-700">
              {preview.text || '(No extractable text — binary or unsupported format. Classification used name/extension signals.)'}
            </pre>
            {preview.truncated && <p className="mt-2 text-[11px] text-ink-400">Text truncated for preview. Full files are never loaded into memory.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
