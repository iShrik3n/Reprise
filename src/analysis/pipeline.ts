import { aggregateRms, aggregateRows, binEdges, l2NormalizeRows, silenceMask } from './aggregate';
import { extractFeatures } from './features';
import { contrastStretch, cosineSelfSimilarity } from './similarity';
import { DEFAULT_OPTIONS, type AnalysisOptions, type AnalysisResult, type ProgressFn } from './types';

/**
 * audio samples → frame features → N time bins → N×N similarity matrix.
 * Pure: no DOM, no globals, deterministic for a given input.
 */
export function analyze(
  signal: Float32Array,
  sampleRate: number,
  options: Partial<AnalysisOptions> = {},
  onProgress?: ProgressFn,
): AnalysisResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const features = extractFeatures(signal, sampleRate, opts, onProgress);

  const edges = binEdges(features.frameCount, opts.maxBins);
  const n = edges.length - 1;
  const chroma = aggregateRows(features.chroma, edges);
  l2NormalizeRows(chroma);
  const silent = silenceMask(aggregateRms(features.rms, edges));

  const similarity = cosineSelfSimilarity(chroma, silent, onProgress);
  const display = contrastStretch(similarity);

  const secondsPerFrame = features.hopSize / sampleRate;
  const duration = signal.length / sampleRate;
  const timeEdges = new Float64Array(n + 1);
  for (let b = 0; b <= n; b++) timeEdges[b] = Math.min(duration, edges[b] * secondsPerFrame);
  timeEdges[n] = duration;

  return { duration, size: n, binEdges: timeEdges, similarity, display };
}
