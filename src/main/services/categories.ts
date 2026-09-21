import type { Category, CategoryId, FileKind } from '../../shared/types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'documents',     name: 'Documents',     color: '#3b82f6', icon: 'FileText',   sort: 0 },
  { id: 'spreadsheets',  name: 'Spreadsheets',  color: '#22c55e', icon: 'Table',      sort: 1 },
  { id: 'presentations', name: 'Presentations', color: '#f97316', icon: 'Presentation', sort: 2 },
  { id: 'images',        name: 'Images',        color: '#a855f7', icon: 'Image',      sort: 3 },
  { id: 'videos',        name: 'Videos',        color: '#ef4444', icon: 'Film',       sort: 4 },
  { id: 'audio',         name: 'Audio',         color: '#ec4899', icon: 'Music',      sort: 5 },
  { id: 'archives',      name: 'Archives',      color: '#eab308', icon: 'Archive',    sort: 6 },
  { id: 'code',          name: 'Code',          color: '#06b6d4', icon: 'Code',       sort: 7 },
  { id: 'design',        name: 'Design',        color: '#d946ef', icon: 'PenTool',    sort: 8 },
  { id: 'fonts',         name: 'Fonts',         color: '#64748b', icon: 'Type',       sort: 9 },
  { id: 'data',          name: 'Data',          color: '#14b8a6', icon: 'Database',   sort: 10 },
  { id: 'books',         name: 'Books',         color: '#84cc16', icon: 'BookOpen',   sort: 11 },
  { id: 'other',         name: 'Other',         color: '#94a3b8', icon: 'File',       sort: 12 },
];

export const KIND_BY_CATEGORY: Record<CategoryId, FileKind> = {
  documents: 'document', spreadsheets: 'spreadsheet', presentations: 'presentation',
  images: 'image', videos: 'video', audio: 'audio', archives: 'archive',
  code: 'code', design: 'design', fonts: 'font', data: 'data', books: 'book', other: 'other',
};

/** Deterministic extension → category map (the strong signal used before ML). */
export const EXTENSION_MAP: Record<string, CategoryId> = {
  // documents
  '.pdf': 'documents', '.doc': 'documents', '.docx': 'documents', '.odt': 'documents',
  '.rtf': 'documents', '.txt': 'documents', '.md': 'documents', '.tex': 'documents',
  '.epub': 'books', '.mobi': 'books', '.azw3': 'books',
  // spreadsheets
  '.xls': 'spreadsheets', '.xlsx': 'spreadsheets', '.ods': 'spreadsheets', '.csv': 'data', '.tsv': 'data',
  // presentations
  '.ppt': 'presentations', '.pptx': 'presentations', '.odp': 'presentations', '.key': 'presentations',
  // images
  '.jpg': 'images', '.jpeg': 'images', '.png': 'images', '.gif': 'images', '.webp': 'images',
  '.bmp': 'images', '.tif': 'images', '.tiff': 'images', '.heic': 'images', '.svg': 'images', '.ico': 'images',
  // videos
  '.mp4': 'videos', '.mkv': 'videos', '.avi': 'videos', '.mov': 'videos', '.webm': 'videos',
  '.wmv': 'videos', '.flv': 'videos', '.m4v': 'videos',
  // audio
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio', '.wma': 'audio',
  // archives
  '.zip': 'archives', '.rar': 'archives', '.7z': 'archives', '.tar': 'archives',
  '.gz': 'archives', '.bz2': 'archives', '.xz': 'archives', '.iso': 'archives',
  // code
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code', '.py': 'code', '.rb': 'code',
  '.go': 'code', '.rs': 'code', '.java': 'code', '.kt': 'code', '.c': 'code', '.cpp': 'code',
  '.h': 'code', '.cs': 'code', '.php': 'code', '.swift': 'code', '.sh': 'code', '.sql': 'code', '.html': 'code', '.css': 'code',
  // design
  '.psd': 'design', '.ai': 'design', '.fig': 'design', '.sketch': 'design', '.xd': 'design', '.indd': 'design',
  // fonts
  '.ttf': 'fonts', '.otf': 'fonts', '.woff': 'fonts', '.woff2': 'fonts',
  // data
  '.json': 'data', '.xml': 'data', '.yaml': 'data', '.yml': 'data', '.db': 'data', '.sqlite': 'data', '.parquet': 'data',
};

export function kindForExt(ext: string): FileKind {
  const cat = EXTENSION_MAP[ext.toLowerCase()];
  return cat ? KIND_BY_CATEGORY[cat] : 'other';
}
