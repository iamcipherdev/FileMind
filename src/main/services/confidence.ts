import type { ConfidenceTier } from '../../shared/types';

/**
 * Confidence engine.
 *  tier high  (>= highThreshold, default 0.90): safe to preselect for apply
 *  tier review (>= reviewThreshold, default 0.70): shown, needs explicit approval
 *  tier low  (< reviewThreshold): recorded but NOT auto-suggested; visible only
 *          in the "Uncertain" section with a "not sure" badge.
 */

export interface Thresholds {
  high: number;   // default 0.90
  review: number; // default 0.70
}

export const DEFAULT_THRESHOLDS: Thresholds = { high: 0.9, review: 0.7 };

export function tierFor(confidence: number, t: Thresholds = DEFAULT_THRESHOLDS): ConfidenceTier {
  if (confidence >= t.high) return 'high';
  if (confidence >= t.review) return 'review';
  return 'low';
}

/** Clamp + round confidence to a sane, display-friendly value. */
export function normalizeConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.min(1, Math.max(0, Math.round(c * 1000) / 1000));
}

/**
 * Blend two independent signals (e.g., deterministic 0.97 + ML 0.82 agreeing).
 * Agreement boosts, disagreement dampens. Noisy-or style, capped at 0.99.
 */
export function blendConfidence(a: number, b: number, agree: boolean): number {
  if (agree) {
    return normalizeConfidence(Math.min(0.99, 1 - (1 - a) * (1 - b) * 0.5));
  }
  return normalizeConfidence(Math.min(a, b) * 0.9);
}
