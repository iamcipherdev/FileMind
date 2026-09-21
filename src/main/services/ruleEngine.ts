import type { Rule, RuleCondition, ScannedFile } from '../../shared/types';

/**
 * Rule engine — deterministic, explainable, user-authored.
 * Priority: lower number wins. First enabled rule that matches decides the plan.
 * All matching is local; nothing here calls the network.
 */

export function evaluateCondition(cond: RuleCondition, file: ScannedFile, contentSnippet?: string): boolean {
  let result: boolean;
  switch (cond.field) {
    case 'name':
      result = stringOp(op(cond), file.name, cond.value);
      break;
    case 'extension':
      result = stringOp(op(cond), file.ext.replace(/^\./, '').toLowerCase(), cond.value.toLowerCase());
      break;
    case 'path':
      result = stringOp(op(cond), file.path, cond.value);
      break;
    case 'kind':
      result = stringOp(op(cond), file.kind, cond.value.toLowerCase());
      break;
    case 'sizeBytes':
      result = numericOp(op(cond), file.sizeBytes, Number(cond.value));
      break;
    case 'ageDays':
      result = numericOp(op(cond), file.ageDays, Number(cond.value));
      break;
    case 'contentContains': {
      if (contentSnippet == null) return false; // content not extracted → condition cannot match
      result = contentSnippet.toLowerCase().includes(cond.value.toLowerCase());
      break;
    }
    default:
      result = false;
  }
  return cond.negate ? !result : result;
}

function op(c: RuleCondition) {
  return c.op;
}

function stringOp(o: RuleCondition['op'], actual: string, expected: string): boolean {
  switch (o) {
    case 'contains':   return actual.toLowerCase().includes(expected.toLowerCase());
    case 'equals':     return actual.toLowerCase() === expected.toLowerCase();
    case 'startsWith': return actual.toLowerCase().startsWith(expected.toLowerCase());
    case 'endsWith':   return actual.toLowerCase().endsWith(expected.toLowerCase());
    case 'regex':
      try { return new RegExp(expected, 'i').test(actual); }
      catch { return false; } // invalid regex → rule simply never matches, surfaced in UI validator
    case 'in':         return expected.split(',').map((s) => s.trim().toLowerCase()).includes(actual.toLowerCase());
    default:           return false;
  }
}

function numericOp(o: RuleCondition['op'], actual: number, expected: number): boolean {
  switch (o) {
    case 'gt': return actual > expected;
    case 'lt': return actual < expected;
    case 'equals': return actual === expected;
    default: return false;
  }
}

export function ruleMatches(rule: Rule, file: ScannedFile, contentSnippet?: string): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  return rule.conditions.every((c) => evaluateCondition(c, file, contentSnippet));
}

/** Evaluate all rules in priority order; return the first match (highest authority). */
export function matchRules(rules: Rule[], file: ScannedFile, contentSnippet?: string): Rule | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, file, contentSnippet)) return rule;
  }
  return null;
}

/** Substitute placeholders in action targets. */
export function renderTarget(template: string, file: ScannedFile, category: string): string {
  const date = new Date(file.mtimeMs);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return template
    .replace(/\{category\}/g, category)
    .replace(/\{yyyy\}/g, String(yyyy))
    .replace(/\{mm\}/g, mm)
    .replace(/\{dd\}/g, dd)
    .replace(/\{ext\}/g, file.ext.replace('.', ''));
}

/** Validate a rule the user built in the visual editor. Returns actionable problems. */
export function validateRule(rule: Rule): string[] {
  const errors: string[] = [];
  if (!rule.name.trim()) errors.push('Give the rule a name so you can recognize it later.');
  if (rule.conditions.length === 0) errors.push('Add at least one condition ("when…") — a rule without conditions matches every file.');
  if (rule.actions.length === 0) errors.push('Add at least one action ("then…") — otherwise the rule does nothing.');
  for (const a of rule.actions) {
    if (a.type === 'move' && !a.targetFolder?.trim()) errors.push('Move action needs a destination folder.');
    if (a.type === 'rename' && !a.pattern?.includes('{name}')) {
      errors.push('Rename pattern must include {name}, otherwise different files would collide.');
    }
  }
  for (const c of rule.conditions) {
    if (c.field === 'sizeBytes' || c.field === 'ageDays') {
      if (Number.isNaN(Number(c.value))) {
        errors.push(`Condition on ${c.field} needs a number, got "${c.value}".`);
      }
    }
    if (c.op === 'regex') {
      try { new RegExp(c.value); } catch (e) {
        errors.push(`Invalid regular expression "${c.value}": ${(e as Error).message}`);
      }
    }
  }
  return errors;
}
