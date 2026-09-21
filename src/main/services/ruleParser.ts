import type { ConditionField, ConditionOp, RuleAction, RuleCondition, RuleDraft } from '../../shared/types';
import { DEFAULT_CATEGORIES } from './categories';

/**
 * Local "natural-language-style" rule parser.
 * This is NOT an AI model — it is a deterministic phrase grammar that runs 100% offline.
 * It accepts flexible English-ish phrasing like:
 *
 *   move invoices to Documents/Finance when name contains invoice
 *   if extension is pdf move to {category}
 *   files older than 90 days → move to Cold Storage
 *   when name starts with screenshot move to Screenshots
 *   rename photos with pattern {name}_{date}
 *
 * Anything it cannot understand produces an actionable error + hints,
 * never a silently wrong rule.
 */

interface ParseState {
  conditions: RuleCondition[];
  actions: RuleAction[];
  name?: string;
}

const FIELD_SYNONYMS: Record<string, ConditionField> = {
  name: 'name', filename: 'name', 'file name': 'name', title: 'name',
  extension: 'extension', ext: 'extension', type: 'extension', filetype: 'extension',
  path: 'path', folder: 'path', location: 'path',
  kind: 'kind',
  size: 'sizeBytes', sizebytes: 'sizeBytes',
  age: 'ageDays', agedays: 'ageDays', ageindays: 'ageDays',
  content: 'contentContains', contentcontains: 'contentContains', contents: 'contentContains', text: 'contentContains',
};

const SIZE_UNITS: Record<string, number> = {
  b: 1, byte: 1, bytes: 1,
  kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3,
};

function fieldFrom(token: string): ConditionField | null {
  const key = token.toLowerCase().trim();
  return FIELD_SYNONYMS[key] ?? null;
}

function splitClauses(text: string): string[] {
  // Split on: "when" / "if" / "and" / "then" / arrow / comma+when
  return text
    .split(/\b(?:when|if|and then|then|and)\b|->|→|;/gi)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSize(value: string): number | null {
  const m = value.match(/^([\d.]+)\s*([a-z]+)$/i);
  if (!m) return null;
  const num = Number(m[1]);
  const unit = SIZE_UNITS[m[2].toLowerCase()];
  if (Number.isNaN(num) || !unit) return null;
  return Math.round(num * unit);
}

function tryParseCondition(clause: string, st: ParseState): boolean {
  const c = clause.toLowerCase();

  // "older than N days"
  let m = c.match(/older\s+than\s+(\d+)\s*(days?|d)/);
  if (m) {
    st.conditions.push({ field: 'ageDays', op: 'gt', value: m[1] });
    return true;
  }
  // "newer than N days"
  m = c.match(/newer\s+than\s+(\d+)\s*(days?|d)/);
  if (m) {
    st.conditions.push({ field: 'ageDays', op: 'lt', value: m[1] });
    return true;
  }
  // "larger than 10 mb" / "bigger than …"
  m = c.match(/(?:larger|bigger|greater)\s+than\s+([\d.]+\s*[a-z]+)/);
  if (m) {
    const bytes = parseSize(m[1]);
    if (bytes != null) { st.conditions.push({ field: 'sizeBytes', op: 'gt', value: String(bytes) }); return true; }
  }
  // "smaller than 5 mb"
  m = c.match(/(?:smaller|less)\s+than\s+([\d.]+\s*[a-z]+)/);
  if (m) {
    const bytes = parseSize(m[1]);
    if (bytes != null) { st.conditions.push({ field: 'sizeBytes', op: 'lt', value: String(bytes) }); return true; }
  }

  // "<field> contains/equals/is/starts with/ends with <value>"
  m = clause.match(/^\s*([a-zA-Z ]+?)\s+(contains|equals|is|starts\s+with|ends\s+with|matches|in)\s+(.+)$/i);
  if (m) {
    const field = fieldFrom(m[1]);
    if (field) {
      const rawOp = m[2].toLowerCase().replace(/\s+/g, ' ');
      let value = m[3].trim().replace(/^["']|["']$/g, '');
      let opMap: ConditionOp;
      switch (rawOp) {
        case 'contains': opMap = 'contains'; break;
        case 'equals': case 'is': opMap = 'equals'; break;
        case 'starts with': opMap = 'startsWith'; break;
        case 'ends with': opMap = 'endsWith'; break;
        case 'matches': opMap = 'regex'; break;
        case 'in': opMap = 'in'; break;
        default: return false;
      }
      if (field === 'extension') value = value.replace(/^\./, '');
      st.conditions.push({ field, op: opMap, value });
      return true;
    }
  }
  return false;
}

function tryParseAction(clause: string, st: ParseState): boolean {
  const c = clause.trim();

  // move → "move to X" | "move invoices to X" | bare "move X".
  // Strategy: strip the verb, then take everything after the LAST
  // to/into/in/under preposition as the target (subjects like "invoices"
  // in "move invoices to Finance" are covered by the conditions anyway).
  let m = c.match(/^(?:move|put|sort)\b\s*/i);
  if (m) {
    let rest = c.slice(m[0].length).trim();
    rest = rest.replace(/^(?:to|into|in|under)\s+/i, '').trim(); // "move to X"
    const preps = [...rest.matchAll(/\s+(?:to|into|in|under)\s+/gi)];
    if (preps.length > 0) {
      const last = preps[preps.length - 1];
      rest = rest.slice(last.index! + last[0].length).trim();
    } else {
      rest = rest.replace(/^(?:everything|all files|files)\s+/i, '').trim();
    }
    const target = rest.trim().replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '');
    if (target && !/when|if/i.test(target)) {
      st.actions.push({ type: 'move', targetFolder: target });
      return true;
    }
  }

  // rename with pattern → "rename with {name}_{date}" | "rename pattern {name}" | "rename photos with pattern {name}_{date}"
  m = c.match(/^rename\b\s*(.*)$/i);
  if (m) {
    const rest = m[1].trim();
    let pattern = rest;
    const pMarker = [...rest.matchAll(/\bpattern\s+/gi)];
    const wMarker = [...rest.matchAll(/\s+(?:with|to|using)\s+/gi)];
    if (pMarker.length > 0) {
      pattern = rest.slice(pMarker[pMarker.length - 1].index! + pMarker[pMarker.length - 1][0].length).trim();
    } else if (wMarker.length > 0) {
      const last = wMarker[wMarker.length - 1];
      pattern = rest.slice(last.index! + last[0].length).trim();
    }
    pattern = pattern.replace(/^["']|["']$/g, '');
    if (pattern && /\{name\}/.test(pattern)) {
      st.actions.push({ type: 'rename', pattern });
      return true;
    }
    // A rename pattern without {name} would collide every file onto one name —
    // refuse to parse it (the caller reports an actionable error + hints).
  }
  return false;
}

export function parseRulePhrase(text: string): RuleDraft {
  const errors: string[] = [];
  const hints: string[] = [];

  if (!text || !text.trim()) {
    return {
      ok: false,
      errors: ['Type a rule like: move invoices to Documents/Finance when name contains invoice'],
      hints: [
        'Structure: [do something] [to target] when [condition]',
        'Conditions: name contains "…", extension is pdf, older than 90 days, larger than 10 mb',
        'Actions: move to Folder/Path, rename with pattern {name}_{date}',
      ],
    };
  }

  const st: ParseState = { conditions: [], actions: [] };
  const clauses = splitClauses(text);

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const isConditionish = /\b(name|filename|extension|ext|type|size|older|newer|larger|bigger|smaller|less|content|text|kind)\b/.test(lower);
    const parsedCond = tryParseCondition(clause, st);
    const parsedAction = parsedCond ? false : tryParseAction(clause, st);
    if (!parsedCond && !parsedAction) {
      if (isConditionish) {
        errors.push(`Could not understand the condition "${clause}".`);
      } else if (/^(move|put|sort|rename)/i.test(lower)) {
        errors.push(`Could not understand the action "${clause}".`);
      }
      // ignore pure filler words like "files" / "all files"
    }
  }

  if (st.actions.length === 0) {
    errors.push('No action found — add what to do, e.g. "move to Documents/Finance".');
    hints.push('Every rule needs an action: what happens to matching files.');
  }
  if (st.conditions.length === 0) {
    errors.push('No condition found — add when it should apply, e.g. "when name contains invoice".');
    hints.push('A rule without a condition would match every file, which is almost never what you want.');
  }

  // Suggest known category folders when target contains {category}
  for (const a of st.actions) {
    if (a.targetFolder?.includes('{category}')) {
      hints.push(`{category} expands to one of: ${DEFAULT_CATEGORIES.map((c) => c.name).join(', ')}`);
    }
  }

  if (errors.length > 0) {
    if (hints.length === 0) {
      hints.push('Example: move invoices to Documents/Finance when name contains invoice');
      hints.push('Example: move to Screenshots when name starts with screenshot');
    }
    return { ok: false, errors, hints, rule: undefined };
  }

  const name = deriveName(st.conditions, st.actions);
  return {
    ok: true,
    errors: [],
    hints,
    rule: {
      name,
      enabled: true,
      priority: 100,
      conditions: st.conditions,
      actions: st.actions,
      source: 'parsed',
    },
  };
}

function deriveName(conditions: RuleCondition[], actions: RuleAction[]): string {
  const condBits = conditions.map((c) => `${c.field} ${c.op} ${c.value}`.replace(/\s+/g, ' '));
  const actBits = actions.map((a) =>
    a.type === 'move' ? `move to ${a.targetFolder}` : `rename ${a.pattern}`
  );
  return [...actBits, ...condBits].join(' · ').slice(0, 120);
}
