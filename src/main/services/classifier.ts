import fs from 'node:fs';
import path from 'node:path';
import type { Classification, MlStatus } from '../../shared/types';
import { normalizeConfidence } from './confidence';
import { logger } from '../logger';

/**
 * Local ML classifier (ONNX Runtime).
 *
 * HONEST BEHAVIOR CONTRACT:
 *  - If onnxruntime-node or the ONNX model file is missing, this classifier
 *    reports exactly that ("model not installed") and the app falls back to
 *    the deterministic classifier. It NEVER fabricates results or scores.
 *  - The model is only produced by training in ml/ (see MODEL_CARD.md).
 */

export const MODEL_FILE = 'filemind-transformer.onnx';
export const VOCAB_FILE = 'vocab.json';
export const MANIFEST_FILE = 'manifest.json';

interface OnnxSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | BigInt64Array }>>;
  inputNames: string[];
  outputNames: string[];
}

export interface MlClassifier {
  status(): MlStatus;
  predict(features: { name: string; ext: string; contentSnippet?: string | null }): Promise<Classification | null>;
  numLabels(): number;
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

export async function createMlClassifier(modelDir?: string): Promise<MlClassifier> {
  const dir = resolveModelDir(modelDir);
  const modelPath = path.join(dir, MODEL_FILE);
  const vocabPath = path.join(dir, VOCAB_FILE);

  const modelInstalled = fs.existsSync(modelPath);
  let runtimeAvailable = false;
  let ort: Record<string, unknown> | null = null;

  try {
    // Dynamic require: the dependency is optional; absence must degrade, not crash.
    const req = eval('require') as NodeRequire;
    ort = (req('onnxruntime-node') as { InferenceSession: unknown }) ?? null;
    runtimeAvailable = !!ort;
  } catch {
    runtimeAvailable = false;
  }

  const status: MlStatus = {
    runtimeAvailable,
    modelInstalled,
    modelPath: modelInstalled ? modelPath : null,
    message: !runtimeAvailable && !modelInstalled
      ? 'Local ML model not installed. Rule-based organization is active.'
      : !modelInstalled
        ? 'ONNX runtime present but no trained model found. Rule-based organization is active. Train and export via ml/ (see MODEL_CARD.md).'
        : !runtimeAvailable
          ? 'Model found but onnxruntime-node is missing. Run: npm i onnxruntime-node'
          : 'Local ML model ready (runs fully offline).',
  };

  if (!runtimeAvailable || !modelInstalled) {
    return {
      status: () => status,
      predict: async () => null,
      numLabels: () => 0,
    };
  }

  // Load vocab + labels
  let vocab: Record<string, number> = {};
  let labels: string[] = [];
  try {
    vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
    labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  } catch {
    return {
      status: () => ({ ...status, message: 'Model files are incomplete (missing vocab/labels). Rule-based organization is active.' }),
      predict: async () => null,
      numLabels: () => 0,
    };
  }

  // Session creation touches native code (onnxruntime). Any failure here must
  // degrade to the rule engine — it must never reject into the UI startup path.
  let session: OnnxSessionLike;
  try {
    session = await (ort!.InferenceSession as { create: (p: string) => Promise<OnnxSessionLike> }).create(modelPath);
  } catch (err) {
    logger.error('ml', 'ONNX session creation failed — falling back to rule engine', { message: (err as Error).message });
    return {
      status: () => ({
        ...status,
        runtimeAvailable: false,
        message: `Local model could not be loaded (${(err as Error).message.slice(0, 120)}). Rule-based organization is active.`,
      }),
      predict: async () => null,
      numLabels: () => 0,
    };
  }
  const TensorCtor = (ort! as { Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown }).Tensor;
  const maxLen = 64;

  function tokenize(text: string): number[] {
    const tokens = text.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const ids = tokens.slice(0, maxLen - 2).map((t) => vocab[t] ?? vocab['<unk>'] ?? 1);
    return [vocab['<cls>'] ?? 2, ...ids, vocab['<sep>'] ?? 3];
  }

  return {
    status: () => status,
    numLabels: () => labels.length,
    async predict(features) {
      try {
        const text = `${features.name} ${features.ext} ${(features.contentSnippet ?? '').slice(0, 400)}`;
        const ids = tokenize(text);
        const inputIds = new BigInt64Array(maxLen);
        const attention = new Float32Array(maxLen);
        ids.forEach((v, i) => { inputIds[i] = BigInt(v); attention[i] = 1; });

        const feeds: Record<string, unknown> = {};
        feeds[session.inputNames[0]] = new TensorCtor('int64', inputIds, [1, maxLen]);
        feeds[session.inputNames[1]] = new TensorCtor('float32', attention, [1, maxLen]);

        const out = await session.run(feeds);
        const logits = out[session.outputNames[0]].data as Float32Array;
        const probs = softmax(Array.from(logits));
        let bestIdx = 0;
        probs.forEach((p, i) => { if (p > probs[bestIdx]) bestIdx = i; });
        return {
          category: (labels[bestIdx] ?? 'other') as Classification['category'],
          confidence: normalizeConfidence(probs[bestIdx]),
          source: 'ml',
          detail: `Local model: ${labels[bestIdx]} (${Math.round(probs[bestIdx] * 100)}%)`,
        };
      } catch (err) {
        return {
          category: 'other',
          confidence: 0.3,
          source: 'ml',
          detail: `Model inference failed (${(err as Error).message}) — falling back to rules for this file`,
        };
      }
    },
  };
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
