/**
 * Shared types for the pure analysis pipeline (audio → features → matrix).
 * Nothing in src/analysis may touch the DOM, so it runs in Node tests and in a Worker.
 */

/** Row-major matrix of `rows` feature vectors, each `dims` long. */
export interface FeatureMatrix {
  data: Float32Array;
  rows: number;
  dims: number;
}

export interface FrameParams {
  /** Analysis window length in samples (power of two). */
  frameSize: number;
  /** Hop between consecutive frame centers, in samples. */
  hopSize: number;
}

/** Frame-rate features. Frame t is centered at sample t * hopSize. */
export interface FrameFeatures {
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  frameCount: number;
  /** Raw (unnormalized) chroma energy per frame, 12 dims, pitch class 0 = C. */
  chroma: FeatureMatrix;
  /** RMS amplitude per frame (linear). */
  rms: Float32Array;
}

export interface SimilarityMatrix {
  /** N×N, row-major, symmetric. Values roughly in [0, 1]. */
  data: Float32Array;
  size: number;
}

export interface AnalysisOptions extends FrameParams {
  /** Upper bound for the matrix size N (number of time bins). */
  maxBins: number;
}

export interface AnalysisResult {
  duration: number;
  /** Number of time bins N (matrix is N×N). */
  size: number;
  /** N+1 bin edges in seconds; bin b spans [binEdges[b], binEdges[b+1]). */
  binEdges: Float64Array;
  /** Raw cosine similarity. */
  similarity: SimilarityMatrix;
  /** Contrast-stretched similarity in [0, 1], ready to paint. */
  display: SimilarityMatrix;
}

export type ProgressFn = (stage: string, fraction: number) => void;

export const DEFAULT_OPTIONS: AnalysisOptions = {
  frameSize: 2048,
  hopSize: 512,
  maxBins: 2048,
};

/** Sample rate the app analyzes at (decoded audio is resampled to this). */
export const ANALYSIS_SAMPLE_RATE = 22050;
