import { useState } from 'react';
import { Search, FolderInput } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, formatDate } from '../components/ui';
import type { DuplicateGroup, ApplyResult } from '@shared/types';

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ApplyResult | null>(null);

  const scan = async () => {
    const folder = await api.pickFolder('Pick a folder to scan for duplicates');
    if (!folder) return;
    setScanning(true);
    setResult(null);
    const out = await api.findDuplicates([folder]);
    setGroups(out);
    // Preselect every file except the oldest in each group (oldest = keeper)
    const sel = new Set<string>();
    for (const g of out) g.files.slice(1).forEach((f) => sel.add(f.path));
    setSelected(sel);
    setScanning(false);
  };

  const toggle = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const moveToReview = async () => {
    if (groups === null || selected.size === 0) return;
    const folder = await api.pickFolder('Pick the folder where duplicates should be moved for review');
    if (!folder) return;
    const out = await api.moveDuplicates([...selected], folder);
    setResult(out);
    setGroups(null);
    setSelected(new Set());
  };

  const wasted = groups?.reduce((acc, g) => acc + g.sizeBytes * (g.files.length - 1), 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Duplicates</h1>
          <p className="mt-1 text-sm text-ink-500">
            Exact matches by SHA-256 — no guesses. Extras are <b>moved to a review folder</b>, never deleted.
          </p>
        </div>
        <button className="btn-mint" onClick={scan} disabled={scanning}>
          <Search size={14} /> {scanning ? 'Hashing…' : 'Scan a folder'}
        </button>
      </div>

      {groups && groups.length === 0 && (
        <div className="card mt-6 p-8 text-center text-sm text-ink-500">
          No exact duplicates found. 🎉
        </div>
      )}

      {groups && groups.length > 0 && (
        <>
          <div className="mt-6 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm">
            <div>
              <b>{groups.length}</b> duplicate group{groups.length === 1 ? '' : 's'} ·{' '}
              <b>{formatBytes(wasted)}</b> recoverable
            </div>
            <button className="btn-primary" disabled={selected.size === 0} onClick={moveToReview}>
              <FolderInput size={14} /> Move {selected.size} selected to review folder
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <div key={g.hash} className="card p-4">
                <div className="flex items-center justify-between text-xs text-ink-400">
                  <span>{g.files.length} identical files · {formatBytes(g.sizeBytes)} each</span>
                  <span className="font-mono">{g.hash.slice(0, 12)}…</span>
                </div>
                <ul className="mt-2 divide-y divide-ink-100">
                  {g.files.map((f, i) => (
                    <li key={f.path} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-mint-600"
                        disabled={i === 0}
                        checked={selected.has(f.path) || i === 0}
                        onChange={() => toggle(f.path)}
                      />
                      <span className="flex-1 truncate text-sm" title={f.path}>{f.path}</span>
                      {i === 0 ? (
                        <span className="badge bg-mint-100 text-mint-800">keeper (oldest)</span>
                      ) : (
                        <span className="text-xs text-ink-400">{formatDate(f.mtimeMs)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-mint-200 bg-mint-50 p-4 text-sm text-mint-800">
          Moved {result.applied} duplicate(s) to the review folder. Undo is available in History.
          {result.failed.length > 0 && <div className="mt-1 text-amber-700">{result.failed.length} failed: {result.failed[0].error}</div>}
        </div>
      )}

      {!groups && !scanning && (
        <div className="card mt-6 p-8 text-center text-sm text-ink-500">
          Pick a folder to scan. Large files are hashed with streaming SHA-256, so nothing is loaded fully into memory.
        </div>
      )}
    </div>
  );
}
