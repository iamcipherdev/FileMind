import { describe, it, expect } from 'vitest';
import { evaluateCondition, ruleMatches, matchRules, validateRule, renderTarget } from '../src/main/services/ruleEngine';
import type { Rule, RuleCondition, ScannedFile } from '../src/shared/types';

const file = (over: Partial<ScannedFile> = {}): ScannedFile => ({
  path: '/data/Downloads/invoice_march.pdf',
  name: 'invoice_march.pdf',
  ext: '.pdf',
  sizeBytes: 120_000,
  mtimeMs: Date.now() - 100 * 86_400_000,
  ageDays: 100,
  isSymlink: false,
  kind: 'document',
  ...over,
});

const rule = (conditions: RuleCondition[], over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'test rule',
  enabled: true,
  priority: 100,
  conditions,
  actions: [{ type: 'move', targetFolder: '/data/Sorted' }],
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('rule engine: conditions', () => {
  it('matches name contains (case-insensitive)', () => {
    const c: RuleCondition = { field: 'name', op: 'contains', value: 'INVOICE' };
    expect(evaluateCondition(c, file())).toBe(true);
  });
  it('matches extension without the dot', () => {
    expect(evaluateCondition({ field: 'extension', op: 'equals', value: 'pdf' }, file())).toBe(true);
    expect(evaluateCondition({ field: 'extension', op: 'equals', value: 'docx' }, file())).toBe(false);
  });
  it('supports negate', () => {
    expect(evaluateCondition({ field: 'name', op: 'contains', value: 'invoice', negate: true }, file())).toBe(false);
  });
  it('numeric comparisons for size and age', () => {
    expect(evaluateCondition({ field: 'sizeBytes', op: 'gt', value: '1000' }, file())).toBe(true);
    expect(evaluateCondition({ field: 'ageDays', op: 'gt', value: '90' }, file())).toBe(true);
    expect(evaluateCondition({ field: 'ageDays', op: 'lt', value: '10' }, file())).toBe(false);
  });
  it('regex works and bad regex simply never matches', () => {
    expect(evaluateCondition({ field: 'name', op: 'regex', value: '^invoice' }, file())).toBe(true);
    expect(evaluateCondition({ field: 'name', op: 'regex', value: '([' }, file())).toBe(false);
  });
  it('content conditions require an extracted snippet', () => {
    expect(evaluateCondition({ field: 'contentContains', op: 'contains', value: 'total' }, file(), 'total due 12 USD')).toBe(true);
    expect(evaluateCondition({ field: 'contentContains', op: 'contains', value: 'total' }, file(), undefined)).toBe(false);
  });
});

describe('rule engine: matching and priority', () => {
  it('all conditions must match (AND)', () => {
    const r = rule([
      { field: 'extension', op: 'equals', value: 'pdf' },
      { field: 'name', op: 'contains', value: 'tax' },
    ]);
    expect(ruleMatches(r, file())).toBe(false);
  });
  it('disabled rules never match', () => {
    expect(ruleMatches(rule([{ field: 'extension', op: 'equals', value: 'pdf' }], { enabled: false }), file())).toBe(false);
  });
  it('lower priority number wins', () => {
    const low = rule([{ field: 'extension', op: 'equals', value: 'pdf' }], { id: 'low', priority: 10, name: 'low' });
    const high = rule([{ field: 'extension', op: 'equals', value: 'pdf' }], { id: 'high', priority: 500, name: 'high' });
    expect(matchRules([high, low], file())?.id).toBe('low');
  });
});

describe('rule engine: target rendering', () => {
  it('expands {category} and date placeholders', () => {
    const out = renderTarget('/data/Sorted/{category}/{yyyy}', file(), 'Documents');
    expect(out).toContain('/data/Sorted/Documents/');
    expect(out).not.toContain('{yyyy}');
  });
});

describe('rule engine: validation gives actionable errors', () => {
  it('complains about missing conditions and actions', () => {
    const errs = validateRule(rule([], { actions: [] }));
    expect(errs.some((e) => /at least one condition/i.test(e))).toBe(true);
    expect(errs.some((e) => /at least one action/i.test(e))).toBe(true);
  });
  it('complains about rename patterns without {name}', () => {
    const errs = validateRule(rule([{ field: 'name', op: 'contains', value: 'x' }], {
      actions: [{ type: 'rename', pattern: '{date}' }],
    }));
    expect(errs.some((e) => /\{name\}/.test(e))).toBe(true);
  });
  it('complains about non-numeric size conditions', () => {
    const errs = validateRule(rule([{ field: 'sizeBytes', op: 'gt', value: 'abc' }]));
    expect(errs.some((e) => /needs a number/i.test(e))).toBe(true);
  });
});
