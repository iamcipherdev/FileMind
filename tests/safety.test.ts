import { describe, it, expect } from 'vitest';
import {
  isInsideRoot, assertSafeDestination, resolveConflict, sanitizeNameSegment,
  isCautiousFile, isProtectedDir, SafetyError,
} from '../src/main/services/safety';

describe('safety: path containment', () => {
  it('accepts paths strictly inside the root', () => {
    expect(isInsideRoot('/data/root', '/data/root/Docs/a.pdf')).toBe(true);
  });
  it('rejects paths outside the root', () => {
    expect(isInsideRoot('/data/root', '/data/other/a.pdf')).toBe(false);
  });
  it('rejects sibling paths that merely share a prefix', () => {
    expect(isInsideRoot('/data/root', '/data/root-evil/a.pdf')).toBe(false);
  });
  it('rejects the root itself as a destination file', () => {
    expect(isInsideRoot('/data/root', '/data/root')).toBe(false);
  });
  it('blocks traversal attempts', () => {
    expect(isInsideRoot('/data/root', '/data/root/../escape.pdf')).toBe(false);
  });
});

describe('safety: destination validation', () => {
  it('throws on reserved Windows device names', () => {
    expect(() => assertSafeDestination('/data/root', '/data/root/CON.pdf')).toThrow(/reserved Windows device name/i);
    expect(() => assertSafeDestination('/data/root', '/data/root/NUL')).toThrow(/reserved/i);
  });
  it('throws on invalid Windows characters', () => {
    expect(() => assertSafeDestination('/data/root', '/data/root/bad:name?.txt')).toThrow(/characters Windows does not allow/i);
  });
  it('throws on segments ending with space or dot', () => {
    expect(() => assertSafeDestination('/data/root', '/data/root/folder./file.txt')).toThrow(/space or dot/i);
    expect(() => assertSafeDestination('/data/root', '/data/root/report .pdf')).not.toThrow(); // internal space is legal
  });
  it('throws on over-long paths', () => {
    const longName = 'x'.repeat(300) + '.txt';
    expect(() => assertSafeDestination('/data/root', `/data/root/${longName}`)).toThrow(/260|characters/i);
  });
  it('allows a normal path', () => {
    expect(() => assertSafeDestination('/data/root', '/data/root/Documents/a.pdf')).not.toThrow();
  });
});

describe('safety: conflict resolution', () => {
  it('returns the destination untouched when free', () => {
    expect(resolveConflict('/d/a.txt', () => false)).toBe('/d/a.txt');
  });
  it('appends (2), (3)… on collision', () => {
    const taken = new Set(['/d/a.txt', '/d/a (2).txt']);
    expect(resolveConflict('/d/a.txt', (p) => taken.has(p))).toBe('/d/a (3).txt');
  });
  it('never proposes to overwrite', () => {
    const exists = () => true;
    expect(() => resolveConflict('/d/a.txt', exists)).toThrow(/free file name/i);
  });
});

describe('safety: name sanitization', () => {
  it('strips illegal characters', () => {
    expect(sanitizeNameSegment('bad<>:"|name')).toBe('bad-----name');
  });
  it('guards reserved stems', () => {
    expect(sanitizeNameSegment('CON')).toMatch(/^_/);
  });
  it('trims dots and spaces (Windows silently strips them)', () => {
    expect(sanitizeNameSegment('  name. ')).toBe('name');
  });
});

describe('safety: cautious extensions and protected dirs', () => {
  it('flags executables and scripts as cautious', () => {
    expect(isCautiousFile('C:/x/setup.exe')).toBe(true);
    expect(isCautiousFile('C:/x/script.ps1')).toBe(true);
    expect(isCautiousFile('C:/x/photo.jpg')).toBe(false);
  });
  it('detects protected system directories', () => {
    expect(isProtectedDir('C:\\Windows\\System32')).toBe(true);
    expect(isProtectedDir('C:/Users/me/AppData/Roaming')).toBe(true);
    expect(isProtectedDir('/home/me/Documents')).toBe(false);
  });
  it('exposes SafetyError as a named class', () => {
    expect(new SafetyError('x')).toBeInstanceOf(Error);
  });
});
