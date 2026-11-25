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
  /** Seconds of audio analyzed. */
  duration: number;
  /** Raw (unnormalized) chroma energy, 12 dims, pitch class 0 = C. */
  chroma: FeatureMatrix;
  /** MFCC 1..13 (c0 dropped), not yet standardized. */
  mfcc: FeatureMatrix;
  /** RMS amplitude (linear). */
  rms: Float32Array;
  /** Spectral flatness in [0, 1]; ≈0 tonal, ≈0.56 white noise. */
  flatness: Float32Array;
}

/** Features pooled into N time bins, ready for the similarity matrix and coloring. */
export interface BinFeatures {
  size: number;
  duration: number;
  /** N+1 bin edges in seconds; bin b spans [binEdges[b], binEdges[b+1]). */
  binEdges: Float64Array;
  /** L2-normalized chroma. */
  chroma: FeatureMatrix;
  /** Per-coefficient z-scored, then L2-normalized MFCC. */
  mfcc: FeatureMatrix;
  /** Loudness in dBFS. */
  rmsDb: Float32Array;
  flatness: Float32Array;
  /** 1 where the bin is (near) silent. */
  silent: Uint8Array;
}

export interface SimilarityWeights {
  /** Harmony / melody (chroma). */
  chroma: number;
  /** Timbre (MFCC). */
  mfcc: number;
  /** Weight λ of the loudness kernel exp(−|ΔdB| / σ), blended as (1−λ)·cos + λ·kernel. */
  energy: number;
}

export type WeightPreset = 'harmony' | 'timbre' | 'blend';

export const WEIGHT_PRESETS: Record<WeightPreset, SimilarityWeights> = {
  harmony: { chroma: 1, mfcc: 0, energy: 0.1 },
  timbre: { chroma: 0, mfcc: 1, energy: 0.1 },
  blend: { chroma: 0.6, mfcc: 0.4, energy: 0.1 },
};

export interface SimilarityMatrix {
  /** N×N, row-major, symmetric. */
  data: Float32Array;
  size: number;
}

export interface AnalysisOptions extends FrameParams {
  /** Upper bound for the matrix size N (number of time bins). */
  maxBins: number;
  weights: SimilarityWeights;
}

export interface AnalysisResult {
  duration: number;
  /** Number of time bins N (matrix is N×N). */
  size: number;
  binEdges: Float64Array;
  bins: BinFeatures;
  /** Raw combined similarity (cosine-based, diagonal = 1). */
  similarity: SimilarityMatrix;
  /** Contrast-stretched similarity in [0, 1], ready to paint. */
  display: SimilarityMatrix;
}

export type ProgressFn = (stage: string, fraction: number) => void;

export const DEFAULT_OPTIONS: AnalysisOptions = {
  frameSize: 2048,
  hopSize: 512,
  maxBins: 2048,
  weights: WEIGHT_PRESETS.blend,
};

/** Sample rate the app analyzes at (decoded audio is resampled to this). */
export const ANALYSIS_SAMPLE_RATE = 22050;
