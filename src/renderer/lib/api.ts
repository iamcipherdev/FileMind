import type { FilemindApi } from '@shared/types';

/**
 * Typed access to the preload bridge. When the renderer runs in a plain
 * browser (vite dev without electron), a graceful mock keeps UI work possible.
 */

function mockApi(): FilemindApi {
  console.warn('[FileMind] Running outside Electron — using mock API.');
  const noop = async () => undefined;
  return {
    startScan: async () => ({ batchId: 'mock' }),
    cancelScan: noop,
    getSuggestions: async () => [],
    decideSuggestions: noop,
    applySuggestions: async () => ({ batchId: 'mock', applied: 0, failed: [] }),
    classifyFile: async () => ({ category: 'other', confidence: 0.3, source: 'deterministic', detail: 'mock' }),
    extractPreview: async () => ({ text: '', truncated: false }),
    undoBatch: async () => ({ batchId: 'mock', undone: 0, failed: [] }),
    listHistory: async () => [],
    getBatchEntries: async () => [],
    listRules: async () => [],
    saveRule: noop,
    deleteRule: noop,
    parseRulePhrase: async () => ({ ok: false, errors: ['Only available inside the FileMind app.'], hints: [] }),
    testRule: async () => ({ matches: 0, samples: [] }),
    findDuplicates: async () => [],
    moveDuplicates: async () => ({ batchId: 'mock', applied: 0, failed: [] }),
    getSettings: async () => ({
      watchedFolders: [], organizeFolders: [], excludedNames: [],
      highThreshold: 0.9, reviewThreshold: 0.7, autoApplyHigh: false,
      contentExtractEnabled: true, maxContentBytes: 2 * 1024 * 1024,
    }),
    setSettings: async () => ({ rejected: [] }),
    pickFolder: async () => null,
    getMlStatus: async () => ({ runtimeAvailable: false, modelInstalled: false, modelPath: null, message: 'Local ML model not installed. Rule-based organization is active.' }),
    warmupMl: async () => ({ ok: false, numLabels: 0, message: 'mock' }),
    generateDemoFiles: async () => ({ created: 0, dir: '' }),
    getAppInfo: async () => ({ version: '0.1.0', platform: 'browser', dataDir: '', logFilePath: '', dbRecoveredFromCorruption: false }),
    onEvent: () => () => undefined,
    notifyUiReady: async () => undefined,
    marker: async () => undefined,
  };
}

export const api: FilemindApi =
  (window as unknown as { filemind?: FilemindApi }).filemind ?? mockApi();
