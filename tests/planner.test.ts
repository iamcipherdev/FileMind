import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { planForFile } from '../src/main/services/planner';
import type { Rule, Classification } from '../src/shared/types';

const settings = {
  highThreshold: 0.9,
  reviewThreshold: 0.7,
  organizeRoots: ['/data/Downloads'],
};

const existsFree = () => false;

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'invoices rule',
  enabled: true,
  priority: 10,
  conditions: [{ field: 'name', op: 'contains', value: 'invoice' }],
  actions: [{ type: 'move', targetFolder: '/data/Downloads/Finance' }],
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('planner: rule authority', () => {
  it('a matching rule wins over deterministic classification', () => {
    const out = planForFile({
      file: { path: '/data/Downloads/invoice_scan.pdf', name: 'invoice_scan.pdf', ext: '.pdf', sizeBytes: 1, mtimeMs: Date.now(), kind: 'document' },
      rules: [rule()],
      ml: null,
      settings,
      exists: existsFree,
    });
    expect(out.suggestion?.reason).toBe('rule');
    expect(out.suggestion?.toPath).toBe(path.join('/data/Downloads/Finance', 'invoice_scan.pdf'));
    expect(out.suggestion?.confidence).toBe(0.99);
  });

  it('rule moves cannot escape the organize root', () => {
    const out = planForFile({
      file: { path: '/data/Downloads/evil_invoice.pdf', name: 'evil_invoice.pdf', ext: '.pdf', sizeBytes: 1, mtimeMs: Date.now(), kind: 'document' },
      rules: [rule({ actions: [{ type: 'move', targetFolder: '/elsewhere' }] })],
      settings,
      exists: existsFree,
    });
    expect(out.suggestion).toBeNull();
    expect(out.skipped).toMatch(/outside/i);
  });
});

describe('planner: deterministic suggestions', () => {
  it('proposes category moves for known extensions at high confidence', () => {
    const out = planForFile({
      file: { path: '/data/Downloads/photo.jpg', name: 'photo.jpg', ext: '.jpg', sizeBytes: 1, mtimeMs: Date.now(), kind: 'image' },
      rules: [],
      ml: null,
      settings,
      exists: existsFree,
    });
    expect(out.suggestion?.toPath).toBe(path.join('/data/Downloads/Images', 'photo.jpg'));
    expect(out.suggestion?.tier).toBe('high');
    expect(out.classification.source).toBe('deterministic');
  });

  it('never auto-suggests executables or scripts', () => {
    const out = planForFile({
      file: { path: '/data/Downloads/setup.exe', name: 'setup.exe', ext: '.exe', sizeBytes: 1, mtimeMs: Date.now(), kind: 'other' },
      rules: [],
      ml: null,
      settings,
      exists: existsFree,
    });
    expect(out.suggestion).toBeNull();
  });

  it('suppresses low-confidence "other" files entirely', () => {
    const out = planForFile({
      file: { path: '/data/Downloads/mystery.xyz', name: 'mystery.xyz', ext: '.xyz', sizeBytes: 1, mtimeMs: Date.now(), kind: 'other' },
      rules: [],
      ml: null,
      settings,
      exists: existsFree,
    });
    expect(out.suggestion).toBeNull();
    expect(out.classification.category).toBe('other');
  });
});

describe('planner: ML blending (honest signals only)', () => {
  const base = { path: '/data/Downloads/report.docx', name: 'report.docx', ext: '.docx', sizeBytes: 1, mtimeMs: Date.now(), kind: 'document' };

  it('blends ML with deterministic when they agree', () => {
    const ml: Classification = { category: 'documents', confidence: 0.8, source: 'ml', detail: 'model says documents' };
    const out = planForFile({ file: base, rules: [], ml, settings, exists: existsFree });
    expect(out.suggestion?.reason).toBe('ml');
    expect(out.suggestion!.confidence).toBeGreaterThanOrEqual(0.97);
    expect(out.suggestion!.confidence).toBeLessThanOrEqual(0.99);
  });

  it('disagreement keeps the ML category with its own confidence and explains both signals', () => {
    const ml: Classification = { category: 'books', confidence: 0.75, source: 'ml', detail: 'model says books' };
    const out = planForFile({ file: base, rules: [], ml, settings, exists: existsFree });
    expect(out.classification.category).toBe('books');
    expect(out.classification.detail).toContain('extension suggests documents');
  });

  it('null ML (model not installed) falls back cleanly to deterministic', () => {
    const out = planForFile({ file: base, rules: [], ml: null, settings, exists: existsFree });
    expect(out.suggestion?.reason).toBe('deterministic');
  });
});

describe('planner: collision safety inside a plan batch', () => {
  it('two files with the same name get distinct destinations via exists()', () => {
    const taken = new Set<string>();
    const mk = (p: string) => planForFile({
      file: { path: p, name: 'photo.jpg', ext: '.jpg', sizeBytes: 1, mtimeMs: Date.now(), kind: 'image' },
      rules: [],
      ml: null,
      settings,
      exists: (x) => taken.has(x),
    });
    const first = mk('/data/Downloads/photo.jpg');
    taken.add(first.suggestion!.toPath);
    const second = mk('/data/Downloads/sub/photo.jpg');
    expect(second.suggestion!.toPath).toBe(path.join('/data/Downloads/Images', 'photo (2).jpg'));
  });
});
