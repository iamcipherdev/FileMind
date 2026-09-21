import { EXTENSION_MAP, kindForExt } from './categories';
import type { Classification, ScannedFile } from '../../shared/types';

/**
 * Deterministic classifier — the "strong signal" layer that runs before ML.
 * It uses unambiguous evidence only, so its confidence is honest:
 *  - known extension                    → 0.97
 *  - no extension but obvious name/sign → 0.75 (review tier)
 *  - nothing conclusive                 → 'other', 0.30 (never auto-suggested)
 */

const NAME_HINTS: { re: RegExp; category: Classification['category'] }[] = [
  { re: /^(invoice|inv[-_ ]?\d{3,}|receipt|bill)[-_. ]/i, category: 'documents' },
  { re: /(resume|cv)[-_. ]/i, category: 'documents' },
  { re: /screenshot[-_. ]?\d*/i, category: 'images' },
  { re: /^(dsc_|img_|photo)/i, category: 'images' },
  { re: /(backup|archive|export)[-_. ]\d{4}/i, category: 'archives' },
];

export function classifyDeterministic(file: {
  name: string;
  ext: string;
  isSymlink: boolean;
}): Classification {
  const ext = file.ext.toLowerCase();

  if (ext && EXTENSION_MAP[ext]) {
    return {
      category: EXTENSION_MAP[ext],
      confidence: 0.97,
      source: 'deterministic',
      detail: `.${ext.replace('.', '')} files are always ${EXTENSION_MAP[ext]}`,
    };
  }

  for (const hint of NAME_HINTS) {
    if (hint.re.test(file.name)) {
      return {
        category: hint.category,
        confidence: 0.72,
        source: 'deterministic',
        detail: `file name matches the pattern ${hint.re}`,
      };
    }
  }

  return {
    category: 'other',
    confidence: 0.3,
    source: 'deterministic',
    detail: 'No strong signal found — not enough evidence to suggest anything',
  };
}

/** Convenience wrapper for already-scanned files. */
export function classifyScannedFile(file: ScannedFile): Classification {
  return classifyDeterministic({ name: file.name, ext: file.ext, isSymlink: file.isSymlink });
}

export { kindForExt };
export function categoryForExt(ext: string): Classification['category'] {
  return EXTENSION_MAP[ext.toLowerCase()] ?? 'other';
}
