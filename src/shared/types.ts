// Shared types used by both Electron main and renderer processes.

export type CategoryId =
  | 'documents' | 'spreadsheets' | 'presentations' | 'images' | 'videos'
  | 'audio' | 'archives' | 'code' | 'design' | 'fonts' | 'data' | 'books' | 'other';

export interface Category {
  id: CategoryId;
  name: string;
  color: string;   // tailwind-ish hex
  icon: string;    // lucide icon name
  sort: number;
}

// ---------- Rules ----------

export type ConditionField =
  | 'name' | 'extension' | 'path' | 'kind' | 'sizeBytes' | 'ageDays' | 'contentContains';

export type ConditionOp =
  | 'contains' | 'equals' | 'startsWith' | 'endsWith'
  | 'regex' | 'gt' | 'lt' | 'in';

export interface RuleCondition {
  field: ConditionField;
  op: ConditionOp;
  value: string;            // numeric ops parse this; 'in' uses comma-separated list
  negate?: boolean;
}

export type RuleActionType = 'move' | 'rename';

export interface RuleAction {
  type: RuleActionType;
  targetFolder?: string;     // for move; supports {category} placeholder
  pattern?: string;          // for rename; supports {name} {ext} {date} {counter} {category}
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;          // lower runs first
  conditions: RuleCondition[];
  actions: RuleAction[];
  source: 'manual' | 'parsed';
  createdAt: number;
  updatedAt: number;
}

export interface RuleDraft {
  ok: boolean;
  rule?: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>;
  errors: string[];          // actionable messages
  hints: string[];
}

// ---------- Files / scanning ----------

export type CategorySource = 'rule' | 'deterministic' | 'ml' | 'user';

export interface ScannedFile {
  path: string;
  name: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  ageDays: number;
  isSymlink: boolean;
  kind: FileKind;
}

export type FileKind =
  | 'document' | 'image' | 'video' | 'audio' | 'archive'
  | 'code' | 'spreadsheet' | 'presentation' | 'font' | 'data' | 'book' | 'design' | 'other';

export interface ScanProgress {
  scanned: number;
  totalEstimate: number | null;
  currentPath: string;
  done: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface Classification {
  category: CategoryId;
  confidence: number;        // 0..1
  source: CategorySource;
  detail: string;            // human-readable why
}

// ---------- Suggestions / plan ----------

export type ConfidenceTier = 'high' | 'review' | 'low';
export type SuggestionActionType = 'move' | 'rename' | 'move+rename';
export type SuggestionReason = 'rule' | 'deterministic' | 'ml';

export interface Suggestion {
  id: string;
  filePath: string;
  action: SuggestionActionType;
  fromPath: string;
  toPath: string;
  reason: SuggestionReason;
  ruleId?: string;
  detail: string;
  confidence: number;
  tier: ConfidenceTier;
  batchId: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'undone' | 'failed';
}

export interface ApplyResult {
  batchId: string;
  applied: number;
  failed: { path: string; error: string }[];
}

export interface UndoResult {
  batchId: string;
  undone: number;
  failed: { path: string; error: string }[];
}

// ---------- Duplicates ----------

export interface DuplicateGroup {
  hash: string;
  sizeBytes: number;
  files: { path: string; name: string; mtimeMs: number; keep?: boolean }[];
}

// ---------- History ----------

export interface HistoryEntry {
  id: number;
  batchId: string;
  kind: 'apply' | 'undo';
  summary: string;
  appliedCount: number;
  failedCount: number;
  createdAt: number;
  canUndo: boolean;
}

export interface UndoEntryRecord {
  entryIndex: number;
  op: string;
  fromPath: string;
  toPath: string;
  undone: boolean;
}

// ---------- Settings / misc ----------

export interface FileMindSettings {
  watchedFolders: string[];
  organizeFolders: string[];
  excludedNames: string[];      // folder/file names to skip
  highThreshold: number;        // default 0.90
  reviewThreshold: number;      // default 0.70
  autoApplyHigh: boolean;       // default false — always confirm (safety)
  contentExtractEnabled: boolean;
  maxContentBytes: number;      // default 2MB
  /**
   * Transient, never persisted: populated by the main process on read to
   * report saved folders that are currently missing/unreadable/protected.
   */
  folderIssues?: FolderIssue[];
}

/** A saved folder that is missing/unreadable/protected — reported, never fatal. */
export interface FolderIssue {
  path: string;
  role: 'organize' | 'watch';
  issue: 'missing' | 'inaccessible' | 'not-a-folder' | 'protected' | 'error';
}

export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
  logFilePath: string;
  dbRecoveredFromCorruption: boolean;
}

export interface MlStatus {
  runtimeAvailable: boolean;
  modelInstalled: boolean;
  modelPath: string | null;
  message: string;
}

export interface AppEvent {
  type: 'scan-progress' | 'scan-done' | 'fs-change' | 'apply-done' | 'undo-done' | 'notify';
  payload: unknown;
}

export interface FilemindApi {
  // scanning + analysis
  startScan: (roots: string[]) => Promise<{ batchId: string }>;
  cancelScan: () => Promise<void>;
  getSuggestions: (batchId?: string) => Promise<Suggestion[]>;
  decideSuggestions: (ids: string[], decision: 'approved' | 'rejected') => Promise<void>;
  applySuggestions: (ids: string[]) => Promise<ApplyResult>;
  classifyFile: (path: string) => Promise<Classification>;
  extractPreview: (path: string) => Promise<{ text: string; truncated: boolean }>;

  // apply / undo / history
  undoBatch: (batchId: string) => Promise<UndoResult>;
  listHistory: () => Promise<HistoryEntry[]>;
  getBatchEntries: (batchId: string) => Promise<UndoEntryRecord[]>;

  // rules
  listRules: () => Promise<Rule[]>;
  saveRule: (rule: Rule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  parseRulePhrase: (text: string) => Promise<RuleDraft>;
  testRule: (rule: Rule, folder: string) => Promise<{ matches: number; samples: { path: string; to: string }[] }>;

  // duplicates
  findDuplicates: (roots: string[]) => Promise<DuplicateGroup[]>;
  moveDuplicates: (paths: string[], quarantineDir: string) => Promise<ApplyResult>;

  // settings / system
  getSettings: () => Promise<FileMindSettings>;
  setSettings: (s: FileMindSettings) => Promise<{ rejected?: string[] }>;
  pickFolder: (title: string) => Promise<string | null>;
  getMlStatus: () => Promise<MlStatus>;
  generateDemoFiles: (dir: string) => Promise<{ created: number; dir: string }>;
  getAppInfo: () => Promise<AppInfo>;
  notifyUiReady: () => Promise<void>;

  // events
  onEvent: (cb: (e: AppEvent) => void) => () => void;
}
