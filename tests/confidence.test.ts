import { describe, it, expect } from 'vitest';
import { tierFor, blendConfidence, normalizeConfidence } from '../src/main/services/confidence';

describe('confidence tiers (spec defaults)', () => {
  it('high tier starts at 0.90', () => {
    expect(tierFor(0.9)).toBe('high');
    expect(tierFor(0.97)).toBe('high');
  });
  it('review tier covers 0.70–0.89', () => {
    expect(tierFor(0.7)).toBe('review');
    expect(tierFor(0.89)).toBe('review');
  });
  it('below 0.70 is low — never auto-suggested', () => {
    expect(tierFor(0.69)).toBe('low');
    expect(tierFor(0.3)).toBe('low');
  });
  it('custom thresholds are honored', () => {
    expect(tierFor(0.75, { high: 0.8, review: 0.6 })).toBe('review');
  });
});

describe('confidence blending', () => {
  it('agreement of two strong signals boosts confidence', () => {
    const c = blendConfidence(0.97, 0.85, true);
    expect(c).toBeGreaterThan(0.97);
    expect(c).toBeLessThanOrEqual(0.99);
  });
  it('disagreement dampens toward the weaker signal', () => {
    const c = blendConfidence(0.97, 0.6, false);
    expect(c).toBeLessThan(0.6);
  });
});

describe('normalization', () => {
  it('clamps NaN and out-of-range values', () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0);
    expect(normalizeConfidence(1.5)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
  });
  it('rounds to 3 decimals', () => {
    expect(normalizeConfidence(0.123456)).toBe(0.123);
  });
});
