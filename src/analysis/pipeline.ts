import {
  aggregateMean,
  aggregateRms,
  aggregateRows,
  binEdges,
  l2NormalizeRows,
  silenceMask,
  zscoreColumns,
} from './aggregate';
import { extractFeatures } from './features';
import { contrastStretch, weightedSimilarity } from './similarity';
import {
  DEFAULT_OPTIONS,
  type AnalysisOptions,
  type AnalysisResult,
  type BinFeatures,
  type FrameFeatures,
  type ProgressFn,
  type SimilarityMatrix,
  type SimilarityWeights,
} from './types';

/**
 * The pipeline has three pure stages, so callers can cache the expensive early ones:
 *   1. extractFeatures(signal)   frame-rate features (≈43 frames/s)
 *   2. binFeatures(frames, N)    pooled into N time bins, normalized
 *   3. buildMatrix(bins, w)      N×N weighted similarity + display contrast
 */

export function binFeatures(frames: FrameFeatures, maxBins: number): BinFeatures {
  const edges = binEdges(frames.frameCount, maxBins);
  const n = edges.length - 1;

  const rms = aggregateRms(frames.rms, edges);
  const silent = silenceMask(rms);
  const rmsDb = new Float32Array(n);
  for (let b = 0; b < n; b++) rmsDb[b] = 20 * Math.log10(rms[b] + 1e-9);

  const chroma = aggregateRows(frames.chroma, edges);
  l2NormalizeRows(chroma);

  const mfcc = aggregateRows(frames.mfcc, edges);
  const voiced = silent.map((s) => 1 - s);
  zscoreColumns(mfcc, voiced);
  l2NormalizeRows(mfcc);

  const secondsPerFrame = frames.hopSize / frames.sampleRate;
  const timeEdges = new Float64Array(n + 1);
  for (let b = 0; b < n; b++) timeEdges[b] = Math.min(frames.duration, edges[b] * secondsPerFrame);
  timeEdges[n] = frames.duration;

  return {
    size: n,
    duration: frames.duration,
    binEdges: timeEdges,
    chroma,
    mfcc,
    rmsDb,
    flatness: aggregateMean(frames.flatness, edges),
    silent,
  };
}

export function buildMatrix(
  bins: BinFeatures,
  weights: SimilarityWeights,
  onProgress?: ProgressFn,
): { similarity: SimilarityMatrix; display: SimilarityMatrix } {
  const similarity = weightedSimilarity(bins.chroma, bins.mfcc, weights, {
    silent: bins.silent,
    energyDb: bins.rmsDb,
    onProgress,
  });
  return { similarity, display: contrastStretch(similarity) };
}

/** audio samples → frame features → N time bins → N×N similarity matrix (all three stages). */
export function analyze(
  signal: Float32Array,
  sampleRate: number,
  options: Partial<AnalysisOptions> = {},
  onProgress?: ProgressFn,
): AnalysisResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const frames = extractFeatures(signal, sampleRate, opts, onProgress);
  const bins = binFeatures(frames, opts.maxBins);
  const { similarity, display } = buildMatrix(bins, opts.weights, onProgress);
  return { duration: bins.duration, size: bins.size, binEdges: bins.binEdges, bins, similarity, display };
}
