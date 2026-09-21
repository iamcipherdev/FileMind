import path from 'node:path';

/**
 * Safety guards for every filesystem operation FileMind performs.
 * Nothing in the app may touch the disk without going through these checks.
 */

// Windows reserved device names (also block them on other platforms for consistency).
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const WINDOWS_INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/;
const MAX_PATH_LENGTH = 260; // conservative default without long-path opt-in

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

/** Normalize for comparison: resolve, lowercase on Windows-style drives. */
export function normalizePath(p: string): string {
  const norm = path.normalize(p);
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

/** True if `target` is strictly inside `root` (not equal, not outside). */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Validate a destination path for a move/rename.
 * Throws SafetyError with an actionable message when the path is unsafe.
 */
export function assertSafeDestination(root: string | null, dest: string): void {
  if (!root) {
    throw new SafetyError(
      'This file is not inside any of your organize folders. Add the folder that contains it in Settings first.'
    );
  }
  if (!dest || !path.isAbsolute(dest)) {
    throw new SafetyError('Destination must be an absolute folder path.');
  }
  if (!isInsideRoot(root, dest)) {
    throw new SafetyError(
      `Refusing to move outside the organize root "${root}". ` +
      `Add "${path.dirname(dest)}" as an organize folder in Settings if this is intentional.`
    );
  }
  const name = path.basename(dest);
  const stem = name.replace(/\.[^.]+$/, '');
  if (RESERVED_NAMES.has(stem.toUpperCase()) || RESERVED_NAMES.has(name.toUpperCase())) {
    throw new SafetyError(`"${name}" is a reserved Windows device name and cannot be used.`);
  }
  if (WINDOWS_INVALID_CHARS.test(name)) {
    throw new SafetyError(
      `File name "${name}" contains characters Windows does not allow (<>:"|?* or control chars).`
    );
  }
  if (dest.length >= MAX_PATH_LENGTH) {
    throw new SafetyError(
      `Target path is ${dest.length} characters; Windows may reject paths of ${MAX_PATH_LENGTH}+. ` +
      'Choose a shorter folder or file name.'
    );
  }
  // No path-segment should end with space or dot (Windows silently strips → collision)
  for (const seg of dest.split(/[\\/]/)) {
    if (seg && (seg.endsWith(' ') || seg.endsWith('.'))) {
      throw new SafetyError(
        `Path segment "${seg}" ends with a space or dot, which Windows trims — this causes collisions.`
      );
    }
  }
}

/** Validate a user-typed folder exists and is a real directory (no symlink escape). */
export async function assertRealDirectory(dir: string, fs: typeof import('node:fs/promises')): Promise<void> {
  let st;
  try {
    st = await fs.lstat(dir);
  } catch {
    throw new SafetyError(`Folder not found: ${dir}`);
  }
  if (st.isSymbolicLink()) {
    throw new SafetyError(`Refusing to use symlinked folder "${dir}" — add the real target folder instead.`);
  }
  if (!st.isDirectory()) {
    throw new SafetyError(`"${dir}" is not a folder.`);
  }
}

/** Default folder names FileMind refuses to organize into/out of. */
export const PROTECTED_DIR_NAMES = new Set([
  'windows', 'program files', 'program files (x86)', 'programdata',
  'appdata', 'system volume information', '$recycle.bin',
]);

export function isProtectedDir(dirPath: string): boolean {
  const segs = dirPath.split(/[\\/]/).map((s) => s.toLowerCase().trim());
  return segs.some((s) => PROTECTED_DIR_NAMES.has(s));
}

/**
 * Paths FileMind must never organize or watch, even if the user selects a
 * parent folder that contains them: its own config/db/log directory, its
 * installation directory and the system temp dir. Overridable via env in
 * tests (FILEMIND_TEST_RUNTIME_PATHS).
 */
export function isFileMindRuntimePath(p: string): boolean {
  const candidates: string[] = [];

  // Set explicitly by the main process at startup (see main runtime paths).
  for (const key of ['FILEMIND_USERDATA_DIR', 'FILEMIND_INSTALL_DIR', 'FILEMIND_TEMP_DIR']) {
    const v = process.env[key];
    if (v) candidates.push(v);
  }
  // Test hook: extra paths without a real Electron environment.
  const extra = process.env.FILEMIND_TEST_RUNTIME_PATHS;
  if (extra) candidates.push(...extra.split(path.delimiter).filter(Boolean));

  if (candidates.length === 0) return false;
  const norm = (x: string) => {
    const r = path.resolve(x);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const target = norm(p);
  return candidates.some((c) => {
    const base = norm(c);
    return target === base || target.startsWith(base + path.sep);
  });
}

/** Extensions FileMind will never propose to move by default ( executables & scripts ). */
export const CAUTIOUS_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.ps1', '.js', '.mjs', '.cjs', '.vbs', '.scr', '.com', '.jar', '.apk', '.dll',
]);

export function isCautiousFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CAUTIOUS_EXTENSIONS.has(ext);
}

/**
 * Produce a conflict-free destination. If `dest` exists, insert " (2)", " (3)"… before
 * the extension. Pure function — `exists` is injected so it is testable.
 */
export function resolveConflict(dest: string, exists: (p: string) => boolean): string {
  if (!exists(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const stem = path.basename(dest, ext);
  for (let i = 2; i < 10_000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  throw new SafetyError(`Could not find a free file name for "${dest}" after 9999 attempts.`);
}

/** Sanitize a string for use as a folder/file name. */
export function sanitizeNameSegment(input: string): string {
  const cleaned = input
    .replace(/[<>:"|?*\u0000-\u001f\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  if (!cleaned) return 'untitled';
  const stem = cleaned.replace(/\.[^.]+$/, '');
  if (RESERVED_NAMES.has(stem.toUpperCase())) return `_${cleaned}`;
  return cleaned;
}
