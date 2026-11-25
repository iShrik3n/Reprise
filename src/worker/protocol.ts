import type { AnalysisOptions, SimilarityWeights } from '../analysis/types';
import type { RenderPayload } from './engine';

export type WorkerRequest =
  | {
      type: 'analyze';
      id: number;
      /** Transferred, not copied. */
      samples: Float32Array<ArrayBuffer>;
      sampleRate: number;
      options?: Partial<AnalysisOptions>;
    }
  | { type: 'reweight'; id: number; weights: SimilarityWeights };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'result'; id: number; payload: RenderPayload }
  | { type: 'error'; id: number; message: string };

export type { RenderPayload };
