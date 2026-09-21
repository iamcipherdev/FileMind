import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/main/db/database';
import { Repository, salvageFolderList } from '../src/main/db/repository';

/**
 * REGRESSION (TEST 5 — "Corrupt the saved folder setting"):
 * malformed settings must fall back to safe defaults; FileMind must launch
 * and the UI must be able to show something meaningful. Also covers salvaging
 * partially corrupted rows.
 */

function makeRepo(): { repo: Repository; close: () => void } {
  const db = openDatabase(':memory:');
  const repo = new Repository(db);
  repo.ensureCategories();
  return { repo, close: () => db.close() };
}

const setRaw = (repo: Repository, key: string, value: string) => {
  // Raw write to simulate a corrupted row (bypasses setSettings typing).
  (repo as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .run(key, value);
};

describe('Repository.getSettings fault tolerance', () => {
  it('returns safe defaults when nothing is stored', () => {
    const { repo, close } = makeRepo();
    const s = repo.getSettings();
    expect(s.organizeFolders).toEqual([]);
    expect(s.watchedFolders).toEqual([]);
    expect(s.highThreshold).toBeCloseTo(0.9);
    expect(s.autoApplyHigh).toBe(false);
    close();
  });

  it('survives corrupted JSON in watchedFolders and organizeFolders (the bug)', () => {
    const { repo, close } = makeRepo();
    setRaw(repo, 'watchedFolders', '{"not-json-at-all...');
    setRaw(repo, 'organizeFolders', 'C:\\Users\\Me\\Downloads'); // bare path, salvaged
    const s = repo.getSettings();
    expect(s.watchedFolders).toEqual([]);           // unusable → default
    expect(s.organizeFolders).toEqual(['C:\\Users\\Me\\Downloads']); // salvaged
    close();
  });

  it('survives wrong JSON types (string instead of array, objects, nulls)', () => {
    const { repo, close } = makeRepo();
    setRaw(repo, 'organizeFolders', '"C:/just/a/string"');
    setRaw(repo, 'watchedFolders', '{"a":1}');
    setRaw(repo, 'excludedNames', 'null');
    const s = repo.getSettings();
    expect(s.organizeFolders).toEqual(['C:/just/a/string']); // string → salvaged to list
    expect(s.watchedFolders).toEqual([]);
    expect(s.excludedNames).toEqual(['.filemind', 'desktop.ini', 'thumbs.db', '.ds_store']);
    close();
  });

  it('filters non-string garbage out of otherwise valid arrays', () => {
    const { repo, close } = makeRepo();
    setRaw(repo, 'organizeFolders', JSON.stringify(['C:/ok', 42, null, '', 'D:/fine']));
    const s = repo.getSettings();
    expect(s.organizeFolders).toEqual(['C:/ok', 'D:/fine']);
    close();
  });

  it('clamps absurd threshold numbers and repairs false/true spelling', () => {
    const { repo, close } = makeRepo();
    setRaw(repo, 'highThreshold', 'banana');
    setRaw(repo, 'reviewThreshold', '3');
    setRaw(repo, 'maxContentBytes', '-5');
    setRaw(repo, 'autoApplyHigh', 'maybe');
    const s = repo.getSettings();
    expect(s.highThreshold).toBeCloseTo(0.9);
    expect(s.reviewThreshold).toBeCloseTo(0.95);
    expect(s.maxContentBytes).toBe(1024);
    expect(s.autoApplyHigh).toBe(false);
    close();
  });

  it('round-trips valid settings unchanged', () => {
    const { repo, close } = makeRepo();
    repo.setSettings({
      watchedFolders: ['C:/w'],
      organizeFolders: ['C:/o'],
      excludedNames: ['.filemind'],
      highThreshold: 0.85,
      reviewThreshold: 0.6,
      autoApplyHigh: false,
      contentExtractEnabled: false,
      maxContentBytes: 1024,
    });
    const s = repo.getSettings();
    expect(s.organizeFolders).toEqual(['C:/o']);
    expect(s.highThreshold).toBeCloseTo(0.85);
    expect(s.contentExtractEnabled).toBe(false);
    close();
  });
});

describe('salvageFolderList', () => {
  it('recovers a bare windows path', () => {
    expect(salvageFolderList('C:\\Users\\Me\\Downloads')).toEqual(['C:\\Users\\Me\\Downloads']);
  });
  it('recovers quoted paths from a truncated JSON fragment', () => {
    expect(salvageFolderList('["C:\\\\Users\\\\Me\\\\Downloads", "C:\\\\Users\\\\Me\\\\Docum'))
      .toEqual(['C:\\Users\\Me\\Downloads']);
  });
  it('returns null for hopeless garbage', () => {
    expect(salvageFolderList('%%%')).toBeNull();
    expect(salvageFolderList('')).toBeNull();
  });
});
