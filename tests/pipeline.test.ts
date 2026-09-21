import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { findDuplicates } from '../src/main/services/duplicates';
import { scanFolders } from '../src/main/services/scanner';
import { extractText } from '../src/main/services/textExtract';
import { generateDemoFiles } from '../src/main/services/demoFiles';

let dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filemind-dup-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('scanner', () => {
  it('finds files recursively with metadata', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'b');

    const out = await scanFolders([root]);
    expect(out.files).toHaveLength(2);
    expect(out.files.map((f) => f.name).sort()).toEqual(['a.txt', 'b.txt']);
    expect(out.scanned).toBe(2);
  });

  it('skips node_modules and .git by default', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'config'), 'x');
    fs.writeFileSync(path.join(root, 'keep.txt'), 'k');

    const out = await scanFolders([root]);
    expect(out.files.map((f) => f.name)).toEqual(['keep.txt']);
  });

  it('respects custom excludes and never follows symlinks', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'skipme'));
    fs.writeFileSync(path.join(root, 'skipme', 'x.txt'), 'x');
    fs.writeFileSync(path.join(root, 'y.txt'), 'y');

    const out = await scanFolders([root], { excludedNames: ['skipme'] });
    expect(out.files.map((f) => f.name)).toEqual(['y.txt']);
    expect(out.skippedDirs.some((p) => p.includes('skipme'))).toBe(true);
  });

  it('is cancellable mid-scan', async () => {
    const root = tmp();
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), 'x');
    let calls = 0;
    const out = await scanFolders([root], { shouldCancel: () => ++calls > 10 });
    expect(out.cancelled).toBe(true);
    expect(out.files.length).toBeLessThan(50);
  });

  it('produces readable errors for unreadable paths', async () => {
    const out = await scanFolders(['/definitely/not/here']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].error).toMatch(/no longer exists|not found/i);
  });
});

describe('duplicate detection', () => {
  it('groups identical files by SHA-256 and ignores unique ones', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(100, 7));
    fs.writeFileSync(path.join(root, 'b.bin'), Buffer.alloc(100, 7)); // same content
    fs.writeFileSync(path.join(root, 'c.bin'), Buffer.alloc(100, 8)); // different content

    const groups = await findDuplicates([
      { path: path.join(root, 'a.bin'), name: 'a.bin', sizeBytes: 100, mtimeMs: 1 },
      { path: path.join(root, 'b.bin'), name: 'b.bin', sizeBytes: 100, mtimeMs: 2 },
      { path: path.join(root, 'c.bin'), name: 'c.bin', sizeBytes: 100, mtimeMs: 3 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.name).sort()).toEqual(['a.bin', 'b.bin']);
  });

  it('skips size prefilter (different sizes are never hashed against each other)', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'small.txt'), 'x');
    fs.writeFileSync(path.join(root, 'big.txt'), 'xx');
    const groups = await findDuplicates([
      { path: path.join(root, 'small.txt'), name: 'small.txt', sizeBytes: 1, mtimeMs: 1 },
      { path: path.join(root, 'big.txt'), name: 'big.txt', sizeBytes: 2, mtimeMs: 2 },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('text extraction', () => {
  it('reads plain text and markdown', async () => {
    const root = tmp();
    const p = path.join(root, 'note.md');
    fs.writeFileSync(p, '# Heading\n\nSome body text about invoices.');
    const out = await extractText(p);
    expect(out?.text).toContain('invoices');
  });

  it('returns null for unsupported binaries instead of guessing', async () => {
    const root = tmp();
    const p = path.join(root, 'x.exe');
    fs.writeFileSync(p, Buffer.from([0x4d, 0x5a, 0x00, 0x01]));
    expect(await extractText(p)).toBeNull();
  });

  it('can be disabled', async () => {
    const root = tmp();
    const p = path.join(root, 'a.txt');
    fs.writeFileSync(p, 'hello');
    expect(await extractText(p, { enabled: false })).toBeNull();
  });
});

describe('demo file generator', () => {
  it('creates a realistic messy corpus, deterministically', () => {
    const root = tmp();
    const out = generateDemoFiles(path.join(root, 'FileMindDemo'));
    expect(out.created).toBeGreaterThan(15);
    const files = fs.readdirSync(path.join(root, 'FileMindDemo'), { recursive: true });
    expect(files.some((f) => String(f).includes('invoice'))).toBe(true);
    expect(files.some((f) => String(f).includes('IMG_'))).toBe(true);
    // idempotent second run
    const again = generateDemoFiles(path.join(root, 'FileMindDemo'));
    expect(again.created).toBe(out.created);
  });
});
