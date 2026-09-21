import { useEffect, useState } from 'react';
import { Undo2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, shortenPath } from '../components/ui';
import type { HistoryEntry, UndoEntryRecord, UndoResult } from '@shared/types';

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [batch, setBatch] = useState<UndoEntryRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => setEntries(await api.listHistory());
  useEffect(() => { void reload(); }, []);

  const toggle = async (batchId: string) => {
    if (open === batchId) { setOpen(null); setBatch(null); return; }
    setOpen(batchId);
    setBatch(await api.getBatchEntries(batchId));
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    const out: UndoResult = await api.undoBatch(batchId);
    setBusy(false);
    setNotice(out.failed.length === 0
      ? `Reverted ${out.undone} change(s). Everything is back where it was.`
      : `Reverted ${out.undone}, but ${out.failed.length} failed — ${out.failed[0].error}`);
    await reload();
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-bold">History</h1>
      <p className="mt-1 text-sm text-ink-500">Every apply batch is fully reversible. Undo restores original paths — if a spot is taken, files come back as “name (restored)” instead of overwriting.</p>

      {notice && (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{notice}</div>
      )}

      <div className="mt-6 space-y-2">
        {entries.length === 0 && (
          <div className="card p-8 text-center text-sm text-ink-500">Nothing here yet — organize something first.</div>
        )}
        {entries.map((h) => (
          <div key={h.id} className="card p-4">
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={() => toggle(h.batchId)}>
                {open === h.batchId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <span className={`badge ${h.kind === 'apply' ? 'bg-mint-100 text-mint-800' : 'bg-sky-100 text-sky-800'}`}>
                {h.kind === 'apply' ? 'APPLIED' : 'UNDONE'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.summary}</div>
                <div className="text-xs text-ink-400">{formatDate(h.createdAt)} · {h.appliedCount} ok{h.failedCount ? `, ${h.failedCount} failed` : ''}</div>
              </div>
              {h.kind === 'apply' && h.canUndo && (
                <button className="btn-primary" disabled={busy} onClick={() => undo(h.batchId)}>
                  <Undo2 size={14} /> Undo
                </button>
              )}
              {h.kind === 'apply' && !h.canUndo && <span className="badge bg-ink-100 text-ink-500">reverted</span>}
            </div>
            {open === h.batchId && batch && (
              <div className="mt-3 rounded-lg bg-ink-50 p-3 text-xs">
                {batch.length === 0 && <div className="text-ink-400">No individual moves recorded.</div>}
                {batch.map((e) => (
                  <div key={e.entryIndex} className="flex items-center gap-2 py-1">
                    <span className={`badge ${e.undone ? 'bg-sky-100 text-sky-700' : 'bg-mint-100 text-mint-800'}`}>{e.undone ? 'undone' : 'done'}</span>
                    <span className="truncate text-ink-500" title={`${e.fromPath} → ${e.toPath}`}>
                      {shortenPath(e.fromPath, 45)} → {shortenPath(e.toPath, 45)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
