import { sanitizeNameSegment } from './safety';

export interface RenameContext {
  name: string;        // original stem
  ext: string;         // ".pdf"
  category: string;    // human category name
  mtimeMs: number;
  counter: number;     // position within the current apply batch (1-based)
}

/**
 * Smart rename. Supported placeholders:
 *  {name} original file stem   {ext} extension without dot   {category} category name
 *  {date} YYYY-MM-DD (mtime)   {counter} batch counter, zero-padded to 3
 * The result is always sanitized and collision-resolved.
 */
export function renderRename(
  pattern: string,
  ctx: RenameContext,
  taken: (candidateStem: string) => boolean
): string {
  const date = new Date(ctx.mtimeMs);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const stem = pattern
    .replace(/\{name\}/g, ctx.name)
    .replace(/\{ext\}/g, ctx.ext.replace('.', ''))
    .replace(/\{category\}/g, sanitizeNameSegment(ctx.category))
    .replace(/\{date\}/g, iso)
    .replace(/\{counter\}/g, String(ctx.counter).padStart(3, '0'));

  let safeStem = sanitizeNameSegment(stem);
  if (!safeStem) safeStem = 'file';

  if (!taken(safeStem)) return `${safeStem}${ctx.ext}`;

  for (let i = 2; i < 10_000; i++) {
    const candidate = `${safeStem} (${i})`;
    if (!taken(candidate)) return `${candidate}${ctx.ext}`;
  }
  return `${safeStem} (${Date.now()})${ctx.ext}`;
}
