import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Local text extraction for content-aware rules and ML features.
 * Supported: .txt .md .csv .log (direct), .pdf (pdf-parse), .docx (mammoth).
 * Hard size cap — a 4 GB video is never read into memory. Everything is local;
 * no content ever leaves the machine.
 */

export const EXTRACTABLE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.log', '.pdf', '.docx']);
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB of extracted text ceiling
const SNIPPET_LIMIT = 2000;

export interface ExtractResult {
  text: string;
  truncated: boolean;
}

export async function extractText(
  filePath: string,
  opts: { maxBytes?: number; enabled?: boolean } = {}
): Promise<ExtractResult | null> {
  if (opts.enabled === false) return null;
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const ext = path.extname(filePath).toLowerCase();
  if (!EXTRACTABLE_EXTENSIONS.has(ext)) return null;

  try {
    const st = await fs.stat(filePath);
    const readBuf = st.size > max
      ? (await fs.open(filePath, 'r')).read(Buffer.alloc(max), 0, max, 0).then((r) => r.buffer)
      : Promise.resolve(await fs.readFile(filePath));

    const buf = await readBuf;
    const truncated = st.size > max;
    return await decode(buf, ext, truncated);
  } catch {
    return null; // unreadable → rules simply skip content conditions for this file
  }
}

async function decode(buf: Buffer, ext: string, truncated: boolean): Promise<ExtractResult> {
  switch (ext) {
    case '.pdf': {
      const text = await extractPdf(buf);
      return { text: text.slice(0, SNIPPET_LIMIT), truncated: truncated || text.length > SNIPPET_LIMIT };
    }
    case '.docx': {
      const text = await extractDocx(buf);
      return { text: text.slice(0, SNIPPET_LIMIT), truncated: truncated || text.length > SNIPPET_LIMIT };
    }
    default: {
      const text = buf.toString('utf8');
      return { text: text.slice(0, SNIPPET_LIMIT), truncated: truncated || text.length > SNIPPET_LIMIT };
    }
  }
}

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    // pdf-parse's package index.js has a debug side-effect; the lib subpath is the clean entry.
    const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as {
      default: (b: Buffer) => Promise<{ text: string }>;
    };
    const pdfParse = mod.default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
    const out = await pdfParse(buf);
    return cleanText(out?.text ?? '');
  } catch {
    return ''; // encrypted/scanned PDF → no text; classifier falls back to name signals
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  try {
    const mammoth = (await import('mammoth')) as unknown as {
      default?: { extractRawText: (i: { buffer: Buffer }) => Promise<{ value: string }> };
      extractRawText?: (i: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const m = mammoth.default ?? mammoth;
    const out = await m.extractRawText!({ buffer: buf });
    return cleanText(out?.value ?? '');
  } catch {
    return '';
  }
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
