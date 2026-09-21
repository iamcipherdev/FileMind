import path from 'node:path';
import fsSync from 'node:fs';
import type {
  Classification, Rule, Suggestion, ScannedFile, ScanProgress,
} from '../../shared/types';
import { scanFolders } from './scanner';
import { extractText } from './textExtract';
import { planForFile } from './planner';
import type { MlClassifier } from './classifier';

export interface SuggestEngineDeps {
  getRules: () => Promise<Rule[]>;
  ml: MlClassifier;
  settings: {
    organizeRoots: string[];
    excludedNames: string[];
    highThreshold: number;
    reviewThreshold: number;
    contentExtractEnabled: boolean;
    maxContentBytes: number;
  };
}

export interface SuggestRunResult {
  suggestions: Suggestion[];
  classifications: Map<string, Classification>;
  scanned: number;
  skipped: number;
  errors: { path: string; error: string }[];
  cancelled: boolean;
}

export class SuggestionIdProvider {
  private n = 0;
  next(): string {
    this.n += 1;
    return `sug-${Date.now().toString(36)}-${this.n}`;
  }
}

/**
 * The full pipeline: SCAN → ANALYZE → SUGGEST.
 * Classification priority inside planForFile: rules → deterministic → ML.
 * Emits progress so the renderer can show a live counter and cancel button.
 */
export async function runSuggestPipeline(
  roots: string[],
  deps: SuggestEngineDeps,
  opts: {
    shouldCancel: () => boolean;
    onProgress: (p: ScanProgress) => void;
    exists?: (p: string) => boolean;
  }
): Promise<SuggestRunResult> {
  const rules = await deps.getRules();
  const suggestions: Suggestion[] = [];
  const classifications = new Map<string, Classification>();
  const errors: { path: string; error: string }[] = [];
  let skipped = 0;
  const idp = new SuggestionIdProvider();
  const batchId = `batch-${Date.now().toString(36)}`;

  const exists = opts.exists ?? ((p: string) => fsSync.existsSync(p));

  const scan = await scanFolders(roots, {
    excludedNames: deps.settings.excludedNames,
    shouldCancel: opts.shouldCancel,
    onProgress: (scanned, currentPath) => {
      opts.onProgress({
        scanned,
        totalEstimate: null,
        currentPath,
        done: false,
      });
    },
  });

  errors.push(...scan.errors);

  let processed = 0;
  for (const file of scan.files) {
    if (opts.shouldCancel()) break;
    processed += 1;
    if (processed % 20 === 0) {
      opts.onProgress({ scanned: processed, totalEstimate: scan.files.length, currentPath: file.path, done: false });
      await new Promise((r) => setImmediate(r));
    }

    // Content extraction only for supported, reasonably sized text formats.
    const snippet = await extractText(file.path, {
      enabled: deps.settings.contentExtractEnabled,
      maxBytes: deps.settings.maxContentBytes,
    });

    // ML is optional and may be absent — planForFile handles null gracefully.
    let ml: Classification | null = null;
    if (deps.ml && deps.ml.numLabels() > 0) {
      ml = await deps.ml.predict({ name: file.name, ext: file.ext, contentSnippet: snippet?.text ?? null });
    }

    const plan = planForFile({
      file,
      rules,
      ml,
      contentSnippet: snippet?.text ?? null,
      settings: {
        highThreshold: deps.settings.highThreshold,
        reviewThreshold: deps.settings.reviewThreshold,
        organizeRoots: deps.settings.organizeRoots,
      },
      exists: (p) => exists(p) || suggestions.some((s) => path.resolve(s.toPath) === path.resolve(p)),
    });

    classifications.set(file.path, plan.classification);
    if (plan.suggestion) {
      suggestions.push({
        ...plan.suggestion,
        id: idp.next(),
        batchId,
        status: 'pending',
      });
    } else {
      skipped += 1;
    }
  }

  opts.onProgress({ scanned: processed, totalEstimate: scan.files.length, currentPath: '', done: true, cancelled: scan.cancelled });

  return {
    suggestions,
    classifications,
    scanned: scan.scanned,
    skipped,
    errors,
    cancelled: scan.cancelled,
  };
}

export type { ScannedFile };
