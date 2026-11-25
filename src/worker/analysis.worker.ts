/**
 * Thin message adapter around AnalysisEngine. All heavy work (FFT, features, N×N matrix,
 * painting) happens here, off the main thread; large buffers travel as transferables.
 */
import { AnalysisEngine, type RenderPayload } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** The slice of DedicatedWorkerGlobalScope we use (the full "webworker" lib clashes with "DOM"). */
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const engine = new AnalysisEngine();

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

function throttledProgress(id: number) {
  let last = -1;
  let lastStage = '';
  return (stage: string, fraction: number) => {
    // ~1% granularity is plenty and keeps message traffic negligible.
    const pct = Math.floor(fraction * 100);
    if (pct === last && stage === lastStage) return;
    last = pct;
    lastStage = stage;
    post({ type: 'progress', id, stage, fraction });
  };
}

function sendResult(id: number, payload: RenderPayload): void {
  post({ type: 'result', id, payload }, [payload.rgba.buffer, payload.binEdges.buffer]);
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'analyze':
        sendResult(msg.id, engine.analyze(msg.samples, msg.sampleRate, msg.options, msg.view, throttledProgress(msg.id)));
        break;
      case 'update':
        sendResult(msg.id, engine.update({ weights: msg.weights, view: msg.view }, throttledProgress(msg.id)));
        break;
      case 'export':
        sendResult(msg.id, engine.export(msg.size, throttledProgress(msg.id)));
        break;
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
