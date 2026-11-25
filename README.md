# Reprise

Reprise turns a song into a square, time × time artwork. Both axes are time, and pixel (i, j) shows how much the moment at time *i* sounds like the moment at time *j*. Repetition in the music (choruses, loops, riffs, beats) appears as diagonal lines, blocks and checkerboards, so the song's structure becomes visible as geometry.

Everything runs in your browser. Your audio is never uploaded.

> Work in progress. Milestone 1 (decoding plus a grayscale chroma self-similarity matrix) is done. A full write-up of what the picture means and how the math works will come with milestone 4.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (synthetic signals)
npm run build    # type-check + production build
```

## Layout

- `src/analysis/`: the pure DSP pipeline (FFT, chroma, binning, cosine similarity). It has no DOM code and is tested in Node.
- `src/audio/`: decoding, WAV encoding, and the built-in generated demo piece.
- `src/render/`: pure pixel painters (matrix → RGBA).
- `src/ui/`: the canvas stage, drag and drop, and progress display.
- `tests/`: Vitest suites built on synthetic signals.
