/**
 * Main-thread, promise-based facade over the analysis worker.
 * Starting a new analysis while one is running terminates the worker (the only way to
 * stop a synchronous computation mid-flight) and rejects the old request with AbortError.
 */
import type { AnalysisOptions, ProgressFn } from '../analysis/types';
import type { RenderPayload, UpdateRequest, ViewSettings, WorkerRequest, WorkerResponse } from './protocol';

interface Pending {
  resolve: (p: RenderPayload) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressFn;
}

export class AbortError extends Error {
  constructor() {
    super('Superseded by a newer request');
    this.name = 'AbortError';
  }
}

export class AnalysisClient {
  private worker!: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    this.spawn();
  }

  analyze(
    samples: Float32Array<ArrayBuffer>,
    sampleRate: number,
    options?: Partial<AnalysisOptions>,
    view?: Partial<ViewSettings>,
    onProgress?: ProgressFn,
  ): Promise<RenderPayload> {
    if (this.pending.size > 0) this.restart();
    return this.request({ type: 'analyze', id: 0, samples, sampleRate, options, view }, onProgress, [samples.buffer]);
  }

  /** Change weights and/or view; the worker recomputes only what those invalidate. */
  update(req: UpdateRequest, onProgress?: ProgressFn): Promise<RenderPayload> {
    return this.request({ type: 'update', id: 0, ...req }, onProgress);
  }

  /** Render the current view natively at up to size×size (for the poster export). */
  exportImage(size: number, onProgress?: ProgressFn): Promise<RenderPayload> {
    return this.request({ type: 'export', id: 0, size }, onProgress);
  }

  private request(msg: WorkerRequest, onProgress?: ProgressFn, transfer: Transferable[] = []): Promise<RenderPayload> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  private spawn(): void {
    this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.stage, msg.fraction);
      } else {
        this.pending.delete(msg.id);
        if (msg.type === 'result') p.resolve(msg.payload);
        else p.reject(new Error(msg.message));
      }
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      const err = new Error(e.message || 'Analysis worker crashed');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.restart();
    };
  }

  private restart(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new AbortError());
    this.pending.clear();
    this.spawn();
  }
}
