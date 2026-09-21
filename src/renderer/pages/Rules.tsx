import { useEffect, useState } from 'react';
import { Plus, Wand2, Trash2, FlaskConical } from 'lucide-react';
import { api } from '../lib/api';
import type { Rule, RuleDraft, RuleCondition, RuleAction } from '@shared/types';

const FIELDS: { id: RuleCondition['field']; label: string }[] = [
  { id: 'name', label: 'File name' },
  { id: 'extension', label: 'Extension' },
  { id: 'path', label: 'Path' },
  { id: 'kind', label: 'Kind' },
  { id: 'sizeBytes', label: 'Size (bytes)' },
  { id: 'ageDays', label: 'Age (days)' },
  { id: 'contentContains', label: 'Content contains' },
];

const OPS: { id: RuleCondition['op']; label: string }[] = [
  { id: 'contains', label: 'contains' },
  { id: 'equals', label: 'is' },
  { id: 'startsWith', label: 'starts with' },
  { id: 'endsWith', label: 'ends with' },
  { id: 'regex', label: 'matches regex' },
  { id: 'gt', label: '>' },
  { id: 'lt', label: '<' },
];

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [phrase, setPhrase] = useState('');
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [builder, setBuilder] = useState<{ name: string; conditions: RuleCondition[]; actions: RuleAction[]; targetFolder: string; pattern: string }>({
    name: '', conditions: [{ field: 'name', op: 'contains', value: '' }], actions: [], targetFolder: '', pattern: '',
  });
  const [testOut, setTestOut] = useState<{ matches: number; samples: { path: string; to: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => setRules(await api.listRules());
  useEffect(() => { void reload(); }, []);

  const parsePhrase = async () => {
    setDraft(await api.parseRulePhrase(phrase));
  };

  const commitDraft = async (d: RuleDraft) => {
    if (!d.ok || !d.rule) return;
    const rule: Rule = {
      ...d.rule,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await api.saveRule(rule);
      setDraft(null);
      setPhrase('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveBuilder = async () => {
    const actions: RuleAction[] = [];
    if (builder.targetFolder.trim()) actions.push({ type: 'move', targetFolder: builder.targetFolder.trim() });
    if (builder.pattern.trim()) actions.push({ type: 'rename', pattern: builder.pattern.trim() });
    const rule: Rule = {
      id: crypto.randomUUID(),
      name: builder.name.trim() || 'Untitled rule',
      enabled: true,
      priority: 100,
      conditions: builder.conditions.filter((c) => c.value.trim() !== ''),
      actions,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await api.saveRule(rule);
      setCreating(false);
      setTestOut(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const testBuilder = async () => {
    const actions: RuleAction[] = [];
    if (builder.targetFolder.trim()) actions.push({ type: 'move', targetFolder: builder.targetFolder.trim() });
    if (builder.pattern.trim()) actions.push({ type: 'rename', pattern: builder.pattern.trim() });
    const folder = await api.pickFolder('Pick a folder to test this rule against');
    if (!folder) return;
    const out = await api.testRule({
      id: 'test', name: 'test', enabled: true, priority: 100,
      conditions: builder.conditions.filter((c) => c.value.trim() !== ''),
      actions, source: 'manual', createdAt: 0, updatedAt: 0,
    }, folder);
    setTestOut(out);
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rules</h1>
          <p className="mt-1 text-sm text-ink-500">Rules run before anything else. Lower priority number wins. All matching is local and explainable.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(!creating)}>
          <Plus size={14} /> New rule
        </button>
      </div>

      {/* natural-language phrase parser */}
      <div className="card mt-6 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 size={15} className="text-mint-600" /> Write a rule in one sentence
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Deterministic offline grammar — not an AI service. Example: <code className="rounded bg-ink-100 px-1">move invoices to Documents/Finance when name contains invoice</code>
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="input"
            placeholder="move screenshots to Pictures when name starts with screenshot"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />
          <button className="btn-primary" onClick={parsePhrase}>Parse</button>
        </div>

        {draft && !draft.ok && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
            {draft.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>)}
            {draft.hints.map((h, i) => <div key={i} className="mt-1 text-xs text-ink-500">{h}</div>)}
          </div>
        )}
        {draft?.ok && draft.rule && (
          <div className="mt-3 rounded-lg border border-mint-200 bg-mint-50 p-3 text-sm">
            <div className="font-semibold text-mint-800">Understood:</div>
            <div className="mt-1 text-ink-700">
              {draft.rule.actions.map((a) => a.type === 'move' ? `move to ${a.targetFolder}` : `rename with ${a.pattern}`).join(' · ')}
              {' — when '}
              {draft.rule.conditions.map((c) => `${c.field} ${c.op} "${c.value}"`).join(' and ')}
            </div>
            <button className="btn-mint mt-3" onClick={() => commitDraft(draft)}>Save this rule</button>
          </div>
        )}
      </div>

      {/* visual builder */}
      {creating && (
        <div className="card mt-4 p-5">
          <div className="text-sm font-semibold">Visual builder</div>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <input className="input" placeholder="Rule name" value={builder.name} onChange={(e) => setBuilder({ ...builder, name: e.target.value })} />
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-ink-400">When…</div>
              {builder.conditions.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <select className="input w-44" value={c.field} onChange={(e) => {
                    const next = [...builder.conditions];
                    next[i] = { ...c, field: e.target.value as RuleCondition['field'] };
                    setBuilder({ ...builder, conditions: next });
                  }}>
                    {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <select className="input w-40" value={c.op} onChange={(e) => {
                    const next = [...builder.conditions];
                    next[i] = { ...c, op: e.target.value as RuleCondition['op'] };
                    setBuilder({ ...builder, conditions: next });
                  }}>
                    {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <input className="input flex-1" placeholder='value, e.g. "invoice" or 90' value={c.value} onChange={(e) => {
                    const next = [...builder.conditions];
                    next[i] = { ...c, value: e.target.value };
                    setBuilder({ ...builder, conditions: next });
                  }} />
                  {builder.conditions.length > 1 && (
                    <button className="btn-ghost" onClick={() => setBuilder({ ...builder, conditions: builder.conditions.filter((_, j) => j !== i) })}>✕</button>
                  )}
                </div>
              ))}
              <button className="btn-ghost text-sm" onClick={() => setBuilder({ ...builder, conditions: [...builder.conditions, { field: 'name', op: 'contains', value: '' }] })}>
                + add condition (all must match)
              </button>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-ink-400">Then…</div>
              <input className="input" placeholder="Move to folder, e.g. D:/Sorted/{category} or leave empty" value={builder.targetFolder} onChange={(e) => setBuilder({ ...builder, targetFolder: e.target.value })} />
              <input className="input" placeholder='Rename pattern, e.g. {name}_{date} (must include {name})' value={builder.pattern} onChange={(e) => setBuilder({ ...builder, pattern: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn-mint" onClick={saveBuilder}>Save rule</button>
            <button className="btn-ghost" onClick={testBuilder}>
              <FlaskConical size={14} /> Test against a folder…
            </button>
          </div>
          {testOut && (
            <div className="mt-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
              <b>{testOut.matches}</b> file(s) would match. Samples:
              <ul className="mt-1 space-y-1">
                {testOut.samples.slice(0, 5).map((s, i) => (
                  <li key={i} className="truncate">· {s.path.split(/[\\/]/).pop()} → {s.to}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* existing rules */}
      <div className="mt-6 space-y-2">
        {rules.length === 0 && (
          <div className="card p-6 text-sm text-ink-500">
            No rules yet. Rules always beat automatic suggestions, and they never touch .exe/.js/.bat files unless you explicitly move them yourself.
          </div>
        )}
        {rules.map((r) => (
          <div key={r.id} className="card flex items-center gap-4 p-4">
            <input
              type="checkbox"
              className="h-4 w-4 accent-mint-600"
              checked={r.enabled}
              onChange={async (e) => {
                await api.saveRule({ ...r, enabled: e.target.checked, updatedAt: Date.now() });
                await reload();
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="truncate text-xs text-ink-500">
                {r.actions.map((a) => a.type === 'move' ? `move → ${a.targetFolder}` : `rename ${a.pattern}`).join(' · ')}
                {' ⋅ when '}
                {r.conditions.map((c) => `${c.field} ${c.op} "${c.value}"`).join(' ∧ ')}
              </div>
            </div>
            <span className="badge bg-ink-100 text-ink-500">priority {r.priority}</span>
            <span className="badge bg-ink-100 text-ink-500">{r.source === 'parsed' ? 'from sentence' : 'manual'}</span>
            <button
              className="btn-ghost text-red-600"
              onClick={async () => { await api.deleteRule(r.id); await reload(); }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
