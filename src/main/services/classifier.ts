import fs from 'node:fs';
import path from 'node:path';
import type { Classification, MlStatus } from '../../shared/types';
import { logger } from '../logger';
import { marker } from '../bootstrap';
import { DISABLE_ONNX, VARIANT_NAME } from '../variant';
import { MlWorkerClient } from './mlWorkerClient';

/**
 * Local ML classifier (ONNX Runtime in an ISOLATED worker process).
 *
 * ARCHITECTURE (v0.1.4):
 *  - The Electron MAIN process never loads onnxruntime-node. The runtime and
 *    the model session live in a utilityProcess child (see ml/worker.ts).
 *    A native fault in ONNX cannot terminate FileMind anymore — the worker
 *    dies, the failure is caught, and the deterministic/rule classifier
 *    keeps the app fully functional.
 *  - LAZY INITIALIZATION: `ml:status` performs lightweight file/package
 *    checks only. The worker starts the first time real classification is
 *    needed (scan pipeline / explicit warmup) — never on app startup.
 *  - HONEST BEHAVIOR CONTRACT: if anything in the ML stack is missing or
 *    fails, the status says exactly that and the rule engine is used.
 *    Results are never fabricated.
 *  - The model is only produced by training in ml/ (see MODEL_CARD.md).
 */

export const MODEL_FILE = 'filemind-transformer.onnx';
export const VOCAB_FILE = 'vocab.json';
export const MANIFEST_FILE = 'manifest.json';

export interface MlClassifier {
  status(): MlStatus;
  predict(features: { name: string; ext: string; contentSnippet?: string | null }): Promise<Classification | null>;
  numLabels(): number;
  /** Lazily initialize the isolated worker. Only called when classification is actually needed. */
  ensureReady(): Promise<boolean>;
}

export function resolveModelDir(explicit?: string): string {
  if (explicit && fs.existsSync(explicit)) return explicit;
  // packaged: <app>/resources/models ; dev: <repo>/models
  const candidates = [
    path.join(process.resourcesPath ?? '', 'models'),
    path.join(process.cwd(), 'models'),
    path.join(__dirname, '..', '..', '..', 'models'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, MODEL_FILE))) return c;
  }
  return path.join(process.cwd(), 'models');
}

/** Rule-engine-only classifier (no ML). Honest status, never fake results. */
function ruleEngineOnly(status: MlStatus): MlClassifier {
  return {
    status: () => status,
    predict: async () => null,
    numLabels: () => 0,
    ensureReady: async () => false,
  };
}

export async function createMlClassifier(modelDir?: string): Promise<MlClassifier> {
  const dir = resolveModelDir(modelDir);
  const modelInstalled = fs.existsSync(path.join(dir, MODEL_FILE));

  if (DISABLE_ONNX || process.env.FILEMIND_DISABLE_ONNX === '1') {
    marker('ONNX_DISABLED_BY_VARIANT');
    logger.warn('ml', `ML disabled in diagnostic variant ${VARIANT_NAME}`);
    return ruleEngineOnly({
      runtimeAvailable: false,
      modelInstalled,
      modelPath: modelInstalled ? path.join(dir, MODEL_FILE) : null,
      message: `Local ML is disabled in this diagnostic build (${VARIANT_NAME}). Rule-based organization is active.`,
    });
  }

  // Lazy isolated worker: nothing ONNX-related happens until ensureReady() is
  // called by an actual classification request (scan/warmup), or never at all.
  const client = new MlWorkerClient(dir);
  return {
    status: () => client.status(),
    predict: (features) => client.predict(features),
    numLabels: () => client.numLabels(),
    ensureReady: () => client.ensureReady(),
  };
}
