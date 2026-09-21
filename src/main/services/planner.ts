import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Classification, Rule, Suggestion, SuggestionActionType,
} from '../../shared/types';
import { renderTarget, matchRules } from './ruleEngine';
import { classifyDeterministic } from './deterministic';
import { tierFor, blendConfidence, normalizeConfidence, DEFAULT_THRESHOLDS, Thresholds } from './confidence';
import { assertSafeDestination, isCautiousFile, resolveConflict, SafetyError } from './safety';
import { DEFAULT_CATEGORIES, EXTENSION_MAP } from './categories';

export interface PlanInput {
  file: { path: string; name: string; ext: string; sizeBytes: number; mtimeMs: number; kind: string };
  rules: Rule[];
  ml?: Classification | null;             // result of onnx model, if installed
  contentSnippet?: string | null;
  settings: { highThreshold: number; reviewThreshold: number; organizeRoots: string[] };
  exists: (p: string) => boolean;         // filesystem collision probe
}

export interface PlanOutput {
  suggestion: Omit<Suggestion, 'id' | 'batchId' | 'status'> | null;
  classification: Classification;
  skipped?: string;
}

/**
 * Build one suggestion for one file, following the hybrid priority:
 *   1. user rules            (authority 1 — explicit user intent)
 *   2. deterministic signals (authority 2 — extension & strong name evidence)
 *   3. local ML model        (authority 3 — only when installed; never faked)
 * Low-tier results (< reviewThreshold) are returned with a note so the UI can
 * show them under "Uncertain" instead of proposing them.
 */
export function planForFile(input: PlanInput): PlanOutput {
  const { file, rules, settings } = input;
  const thresholds: Thresholds = {
    high: settings.highThreshold || DEFAULT_THRESHOLDS.high,
    review: settings.reviewThreshold || DEFAULT_THRESHOLDS.review,
  };

  // ---- Authority 1: user rules ----
  const rule = matchRules(rules, { ...file, kind: file.kind as never, ageDays: ageDays(file.mtimeMs), isSymlink: false }, input.contentSnippet ?? undefined);
  if (rule) {
    const moveAction = rule.actions.find((a) => a.type === 'move');
    const renameAction = rule.actions.find((a) => a.type === 'rename');
    if (!moveAction && !renameAction) {
      return { suggestion: null, classification: classifyDeterministic({ ...file, isSymlink: false }), skipped: 'Rule matched but has no supported action.' };
    }

    let toPath = file.path;
    let action: SuggestionActionType = 'rename';
    const detailBits: string[] = [];

    if (moveAction?.targetFolder) {
      const root = findRootFor(settings.organizeRoots, file.path);
      const category = guessCategoryName(file);
      const targetDir = renderTarget(moveAction.targetFolder, file as never, category);
      try {
        assertSafeDestination(root, targetDir);
      } catch (e) {
        return {
          suggestion: null,
          classification: classifyDeterministic({ ...file, isSymlink: false }),
          skipped: (e as SafetyError).message,
        };
      }
      const dest = path.join(targetDir, path.basename(file.path));
      toPath = resolveConflict(dest, input.exists);
      action = renameAction ? 'move+rename' : 'move';
      detailBits.push(`Rule "${rule.name}" wants this in ${targetDir}`);
    }

    if (renameAction?.pattern) {
      // rename within destination dir (or current dir when no move)
      const dir = path.dirname(toPath);
      const stem = path.basename(file.path, file.ext);
      const category = guessCategoryName(file);
      const counter = 1;
      let newStem = renameAction.pattern
        .replace(/\{name\}/g, stem)
        .replace(/\{ext\}/g, file.ext.replace('.', ''))
        .replace(/\{category\}/g, category)
        .replace(/\{date\}/g, new Date(file.mtimeMs).toISOString().slice(0, 10))
        .replace(/\{counter\}/g, String(counter).padStart(3, '0'));
      newStem = newStem.replace(/[<>:"|?*\u0000-\u001f\\/]/g, '-').trim();
      const dest = path.join(dir, `${newStem}${file.ext}`);
      toPath = resolveConflict(dest, input.exists);
      if (action === 'rename') action = 'rename';
      detailBits.push(`renamed by pattern "${renameAction.pattern}"`);
    }

    return {
      suggestion: {
        filePath: file.path,
        action,
        fromPath: file.path,
        toPath,
        reason: 'rule',
        ruleId: rule.id,
        detail: detailBits.join(' · '),
        confidence: 0.99,
        tier: 'high',
      },
      classification: {
        category: guessCategoryId(file),
        confidence: 0.99,
        source: 'rule',
        detail: `Matched your rule "${rule.name}"`,
      },
    };
  }

  // ---- Authority 2 + 3: deterministic vs ML (blend when both exist) ----
  const det = classifyDeterministic({ ...file, isSymlink: false });
  const ml = input.ml ?? null;

  let classification: Classification;
  if (ml && ml.category !== 'other') {
    const agree = ml.category === det.category;
    const conf = agree ? blendConfidence(det.confidence, ml.confidence, true) : ml.confidence;
    classification = {
      category: agree ? det.category : ml.category,
      confidence: normalizeConfidence(conf),
      source: 'ml',
      detail: agree
        ? `Local model and file extension both say ${ml.category}`
        : `Local model says ${ml.category} (${Math.round(ml.confidence * 100)}%)${det.category !== 'other' ? `; extension suggests ${det.category}` : ''}`,
    };
  } else {
    classification = det;
  }

  // Executables & scripts are never auto-suggested (safety policy), only classified.
  if (isCautiousFile(file.path) && classification.source !== 'rule') {
    return {
      suggestion: null,
      classification: { ...classification, detail: `${classification.detail} — installer/script files are never auto-suggested` },
      skipped: 'Cautious extension: shown as info only.',
    };
  }

  const tier = tierFor(classification.confidence, thresholds);
  if (tier === 'low' || classification.category === 'other') {
    return { suggestion: null, classification, skipped: 'Confidence below review threshold — nothing proposed.' };
  }

  // Build move target: <organize root>/<Category>/<yyyy>
  const root = findRootFor(settings.organizeRoots, file.path);
  if (!root) {
    return { suggestion: null, classification, skipped: 'File is not inside an organize folder.' };
  }
  const catName = DEFAULT_CATEGORIES.find((c) => c.id === classification.category)?.name ?? 'Other';
  const targetDir = path.join(root, catName);
  try {
    assertSafeDestination(root, path.join(targetDir, path.basename(file.path)));
  } catch (e) {
    return { suggestion: null, classification, skipped: (e as SafetyError).message };
  }
  const dest = resolveConflict(path.join(targetDir, path.basename(file.path)), input.exists);

  return {
    suggestion: {
      filePath: file.path,
      action: 'move',
      fromPath: file.path,
      toPath: dest,
      reason: classification.source === 'ml' ? 'ml' : 'deterministic',
      detail: classification.detail,
      confidence: classification.confidence,
      tier,
    },
    classification,
  };
}

function ageDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
}

function findRootFor(roots: string[], filePath: string): string | null {
  for (const root of roots) {
    const rel = path.relative(path.resolve(root), path.resolve(filePath));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return root;
  }
  return null;
}

function guessCategoryId(file: { ext: string }): Classification['category'] {
  return EXTENSION_MAP[file.ext.toLowerCase()] ?? 'other';
}

function guessCategoryName(file: { ext: string }): string {
  const id = guessCategoryId(file);
  return DEFAULT_CATEGORIES.find((c) => c.id === id)?.name ?? 'Other';
}

export function newSuggestionId(): string {
  return crypto.randomUUID();
}
