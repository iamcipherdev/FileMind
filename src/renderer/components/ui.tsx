import type { ConfidenceTier } from '@shared/types';

export function TierBadge({ tier }: { tier: ConfidenceTier }) {
  if (tier === 'high') {
    return <span className="badge bg-mint-100 text-mint-800">● High confidence</span>;
  }
  if (tier === 'review') {
    return <span className="badge bg-amber-100 text-amber-800">● Needs review</span>;
  }
  return <span className="badge bg-ink-100 text-ink-500">● Not sure</span>;
}

export function Pct({ v }: { v: number }) {
  return <span className="tabular-nums">{Math.round(v * 100)}%</span>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function shortenPath(p: string, max = 60): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max);
}
