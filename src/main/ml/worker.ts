import fs from 'node:fs';
import path from 'node:path';
import { marker } from '../bootstrap';

/**
 * ML worker entry — runs in an Electron utilityProcess (isolated Node child).
 *
 * The Electron MAIN process must never load onnxruntime-node: a native DLL
 * fault in the runtime would otherwise terminate the whole app. Here a crash
 * only kills this child; the main process catches the exit event and FileMind
 * continues with the deterministic/rule classifier (honest fallback, never
 * fabricated results).
 *
 * Protocol (structured-clone messages over process.parentPort):
 *   main -> worker : { type: 'init', modelDir, reqId }
 *                    { type: 'predict', reqId, features }
 *   worker -> main : { type: 'init-ok', reqId, numLabels }
 *                    { type: 'init-fail', reqId, message }
 *                    { type: 'prediction', reqId, classification }
 *                    { type: 'predict-fail', reqId, message }
 */

interface Port {
  on(event: 'message', listener: (m: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: Port }).parentPort ?? null;

let session: {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | BigInt64Array }>>;
  inputNames: string[];
  outputNames: string[];
} | null = null;
let TensorCtor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
let labels: string[] = [];
let vocab: Record<string, number> = {};

const MAX_LEN = 64;

function tokenize(text: string): number[] {
  const tokens = text.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ids = tokens.slice(0, MAX_LEN - 2).map((t) => vocab[t] ?? vocab['<unk>'] ?? 1);
  return [vocab['<cls>'] ?? 2, ...ids, vocab['<sep>'] ?? 3];
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

async function init(modelDir: string): Promise<{ numLabels: number }> {
  marker('ONNX_REQUIRE_STARTED');
  const req = eval('require') as NodeRequire;
  const ort = req('onnxruntime-node') as {
    InferenceSession: { create: (p: string) => Promise<typeof session & object> };
    Tensor: typeof TensorCtor;
  };
  marker('ONNX_REQUIRE_SUCCESS');
  TensorCtor = ort.Tensor;
  marker('ONNX_SESSION_STARTED');
  session = await ort.InferenceSession.create(path.join(modelDir, 'filemind-transformer.onnx'));
  marker('ONNX_SESSION_SUCCESS');
  vocab = JSON.parse(fs.readFileSync(path.join(modelDir, 'vocab.json'), 'utf8'));
  labels = JSON.parse(fs.readFileSync(path.join(modelDir, 'labels.json'), 'utf8'));
  return { numLabels: labels.length };
}

function predict(features: { name: string; ext: string; contentSnippet?: string | null }) {
  if (!session) throw new Error('worker session not ready');
  const text = `${features.name} ${features.ext} ${(features.contentSnippet ?? '').slice(0, 400)}`;
  const ids = tokenize(text);
  const inputIds = new BigInt64Array(MAX_LEN);
  const attention = new Float32Array(MAX_LEN);
  ids.forEach((v, i) => { inputIds[i] = BigInt(v); attention[i] = 1; });

  const feeds: Record<string, unknown> = {};
  feeds[session.inputNames[0]] = new TensorCtor('int64', inputIds, [1, MAX_LEN]);
  feeds[session.inputNames[1]] = new TensorCtor('float32', attention, [1, MAX_LEN]);
  return session.run(feeds).then((out) => {
    const logits = out[session!.outputNames[0]].data as Float32Array;
    const probs = softmax(Array.from(logits));
    let best = 0;
    probs.forEach((p, i) => { if (p > probs[best]) best = i; });
    return { category: labels[best] ?? 'other', prob: probs[best] };
  });
}

port?.on('message', (m: { data: unknown }) => {
  const d = m.data as { type: string; reqId: number; modelDir?: string; features?: { name: string; ext: string; contentSnippet?: string | null } };
  if (d.type === 'init') {
    init(d.modelDir ?? '')
      .then((r) => port?.postMessage({ type: 'init-ok', reqId: d.reqId, numLabels: r.numLabels }))
      .catch((err: Error) => port?.postMessage({ type: 'init-fail', reqId: d.reqId, message: err.message }));
  } else if (d.type === 'predict') {
    predict(d.features!)
      .then((r) => port?.postMessage({ type: 'prediction', reqId: d.reqId, category: r.category, prob: r.prob }))
      .catch((err: Error) => port?.postMessage({ type: 'predict-fail', reqId: d.reqId, message: err.message }));
  }
});
