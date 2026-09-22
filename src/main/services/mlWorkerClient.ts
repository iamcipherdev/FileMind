import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess, UtilityProcess } from 'electron';
import type { Classification, MlStatus } from '../../shared/types';
import { logger } from '../logger';
import { marker } from '../bootstrap';
import { MODEL_FILE } from './classifier';

/**
 * Client for the isolated ML worker (Electron utilityProcess).
 *
 * Guarantees:
 *  - The main process NEVER loads onnxruntime-node. The worker does.
 *  - LAZY: the worker only starts when real classification is requested
 *    (scan pipeline). ml:status is a lightweight file/package check and
 *    never spawns the worker or creates a session.
 *  - A worker crash cannot terminate FileMind: the exit is caught, pending
 *    predictions are failed gracefully and callers fall back to the
 *    deterministic/rule classifier.
 *  - Bounded retries: after 3 consecutive worker failures ML stays disabled
 *    for the rest of the session (honest status message, no fake results).
 */

type PendingResolve = (value: { ok: boolean; numLabels?: number; category?: string; prob?: number; message?: string }) => void;

export class MlWorkerClient {
  private child: UtilityProcess | null = null;
  private pending = new Map<number, PendingResolve>();
  private reqId = 0;
  private ready = false;
  private numLabels_ = 0;
  private consecutiveFailures = 0;
  private starting: Promise<boolean> | null = null;
  private lastError: string | null = null;

  constructor(private modelDir: string) {}

  /** Lightweight status — file/package checks only. NEVER spawns the worker. */
  status(): MlStatus {
    const modelInstalled = fs.existsSync(path.join(this.modelDir, MODEL_FILE));
    const runtimePkg = path.join(process.cwd(), 'node_modules', 'onnxruntime-node', 'package.json');
    const runtimeAvailable = fs.existsSync(runtimePkg);
    let message: string;
    if (!modelInstalled && !runtimeAvailable) {
      message = 'Local ML model not installed. Rule-based organization is active.';
    } else if (!modelInstalled) {
      message = 'ONNX runtime present but no trained model found. Rule-based organization is active. Train and export via ml/ (see MODEL_CARD.md).';
    } else if (this.consecutiveFailures >= 3) {
      message = `Local model is unavailable in this session (${this.lastError ?? 'worker failures'}). Rule-based organization is active.`;
    } else {
      message = 'Local ML model installed — it loads in an isolated worker the first time classification is needed (the app stays safe if it fails).';
    }
    return { runtimeAvailable, modelInstalled, modelPath: modelInstalled ? path.join(this.modelDir, MODEL_FILE) : null, message };
  }

  /** Spawn + initialize the worker once. Safe to call repeatedly. */
  async ensureReady(): Promise<boolean> {
    if (this.ready) return true;
    if (this.consecutiveFailures >= 3) return false;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      try {
        marker('ML_WORKER_SPAWN_STARTED');
        this.spawnChild();
        const ok = await this.request({ type: 'init', modelDir: this.modelDir }, 30_000);
        if (ok.ok) {
          this.ready = true;
          this.numLabels_ = ok.numLabels ?? 0;
          this.consecutiveFailures = 0;
          marker('ML_WORKER_READY');
          logger.info('ml', 'isolated ML worker ready', { numLabels: this.numLabels_ });
          return true;
        }
        this.lastError = ok.message ?? 'init failed';
        throw new Error(this.lastError);
      } catch (err) {
        this.consecutiveFailures += 1;
        this.lastError = (err as Error).message;
        this.killChild();
        marker('ML_WORKER_FAILED');
        logger.error('ml', 'ML worker failed — deterministic classifier stays active', { message: this.lastError });
        return false;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  async predict(features: { name: string; ext: string; contentSnippet?: string | null }): Promise<Classification | null> {
    if (!(await this.ensureReady())) return null;
    try {
      const res = await this.request({ type: 'predict', features }, 15_000);
      if (!res.ok || typeof res.category !== 'string') throw new Error(res.message ?? 'prediction failed');
      return {
        category: res.category as Classification['category'],
        confidence: Math.max(0, Math.min(1, res.prob ?? 0)),
        source: 'ml',
        detail: `Local model: ${res.category} (${Math.round((res.prob ?? 0) * 100)}%)`,
      };
    } catch (err) {
      logger.warn('ml', 'prediction failed — falling back to rules for this file', { message: (err as Error).message });
      return null;
    }
  }

  numLabels(): number {
    return this.ready ? this.numLabels_ : 0;
  }

  dispose(): void {
    this.killChild();
  }

  // ------------------------------------------------------------------ internals

  private spawnChild(): void {
    this.killChild();
    const workerPath = path.join(__dirname, '..', 'ml', 'worker.js');
    this.child = utilityProcess.fork(workerPath);
    this.child.on('message', (m: unknown) => {
      const d = m as { type: string; reqId: number; numLabels?: number; message?: string; category?: string; prob?: number };
      const resolve = this.pending.get(d.reqId);
      if (!resolve) return;
      this.pending.delete(d.reqId);
      if (d.type === 'init-ok') resolve({ ok: true, numLabels: d.numLabels });
      else if (d.type === 'prediction') resolve({ ok: true, category: d.category, prob: d.prob });
      else resolve({ ok: false, message: d.message ?? d.type });
    });
    this.child.on('exit', (code) => {
      logger.warn('ml', 'ML worker exited', { code });
      // Fail everything in flight; ensureReady() will respawn on next use.
      for (const [, resolve] of this.pending) resolve({ ok: false, message: 'ML worker exited unexpectedly' });
      this.pending.clear();
      this.ready = false;
      this.child = null;
    });
  }

  private killChild(): void {
    if (this.child) {
      try { this.child.kill(); } catch { /* ignore */ }
      this.child = null;
    }
    this.ready = false;
  }

  private request(msg: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; numLabels?: number; category?: string; prob?: number; message?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.child) { reject(new Error('ML worker not running')); return; }
      const reqId = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve({ ok: false, message: `worker request timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      this.pending.set(reqId, (value) => { clearTimeout(timer); resolve(value); });
      try {
        this.child.postMessage({ ...msg, reqId });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err as Error);
      }
    });
  }
}
