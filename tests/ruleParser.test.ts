import { describe, it, expect } from 'vitest';
import { parseRulePhrase } from '../src/main/services/ruleParser';

describe('rule parser: golden phrases', () => {
  it('parses "move X to Y when name contains Z"', () => {
    const out = parseRulePhrase('move invoices to Documents/Finance when name contains invoice');
    expect(out.ok).toBe(true);
    expect(out.rule?.actions[0]).toEqual({ type: 'move', targetFolder: 'Documents/Finance' });
    expect(out.rule?.conditions[0]).toMatchObject({ field: 'name', op: 'contains', value: 'invoice' });
  });

  it('parses extension conditions with or without dot', () => {
    const out = parseRulePhrase('move to Documents when extension is .pdf');
    expect(out.ok).toBe(true);
    expect(out.rule?.conditions[0]).toMatchObject({ field: 'extension', op: 'equals', value: 'pdf' });
  });

  it('parses age conditions', () => {
    const out = parseRulePhrase('move to Cold Storage when older than 90 days');
    expect(out.ok).toBe(true);
    expect(out.rule?.conditions[0]).toMatchObject({ field: 'ageDays', op: 'gt', value: '90' });
  });

  it('parses size conditions with units', () => {
    const out = parseRulePhrase('move to Big Files when larger than 100 mb');
    expect(out.ok).toBe(true);
    expect(out.rule?.conditions[0]).toMatchObject({ field: 'sizeBytes', op: 'gt', value: String(100 * 1024 * 1024) });
  });

  it('parses starts-with and screenshots', () => {
    const out = parseRulePhrase('move screenshots to Pictures when name starts with screenshot');
    expect(out.ok).toBe(true);
    expect(out.rule?.conditions[0]).toMatchObject({ field: 'name', op: 'startsWith', value: 'screenshot' });
    expect(out.rule?.actions[0]).toMatchObject({ type: 'move', targetFolder: 'Pictures' });
  });

  it('parses rename patterns', () => {
    const out = parseRulePhrase('rename photos with pattern {name}_{date} when extension is jpg');
    expect(out.ok).toBe(true);
    expect(out.rule?.actions[0]).toMatchObject({ type: 'rename', pattern: '{name}_{date}' });
  });

  it('handles if/then phrasing', () => {
    const out = parseRulePhrase('if extension is docx then move to Documents/Word');
    expect(out.ok).toBe(true);
    expect(out.rule?.actions[0]).toMatchObject({ targetFolder: 'Documents/Word' });
  });
});

describe('rule parser: failure modes are actionable, never silent', () => {
  it('rejects empty input with examples', () => {
    const out = parseRulePhrase('');
    expect(out.ok).toBe(false);
    expect(out.hints.length).toBeGreaterThan(0);
  });

  it('reports a missing action', () => {
    const out = parseRulePhrase('when name contains invoice');
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/no action found/i);
  });

  it('reports a missing condition', () => {
    const out = parseRulePhrase('move to Documents');
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/no condition found/i);
  });

  it('rejects rename patterns without {name}', () => {
    const out = parseRulePhrase('rename with {date} when name contains a');
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/no action|rename/i);
  });

  it('never produces a rule with zero conditions or zero actions', () => {
    for (const bad of ['hello world', 'move', 'when extension is pdf move', 'files and stuff']) {
      const out = parseRulePhrase(bad);
      if (out.ok && out.rule) {
        expect(out.rule.conditions.length).toBeGreaterThan(0);
        expect(out.rule.actions.length).toBeGreaterThan(0);
      }
    }
  });
});
