// Indice d'intelligibilité STOI (Taal et al., « An Algorithm for Intelligibility
// Prediction of Time-Frequency Weighted Noisy Speech », IEEE TASLP, 2011), entre 0 et 1.
// Compare une voix dégradée à la voix propre de référence, toutes deux à 10 kHz.
// Transcription de l'implémentation de référence pystoi (MIT), vérifiée contre elle
// (voir test/stoi.test.ts).
export const STOI_RATE = 10_000;

const FRAME = 256;
const HOP = FRAME / 2;
const NFFT = 512;
const BANDS = 15;
const MIN_FREQ = 150;
const SEGMENT = 30;
const BETA_DB = -15;
const DYN_RANGE_DB = 40;
const EPS = 2.220446049250313e-16;

// Fenêtre de Hann de pystoi : np.hanning(FRAME + 2)[1:-1]
const WINDOW = Float64Array.from(
  { length: FRAME },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (FRAME + 1)),
);

function frameStarts(length: number): number[] {
  const starts: number[] = [];
  for (let i = 0; i < length - FRAME; i += HOP) starts.push(i);
  return starts;
}

function windowed(signal: Float32Array | Float64Array, start: number): Float64Array {
  return Float64Array.from(WINDOW, (w, i) => w * signal[start + i]);
}

function norm(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
  return Math.sqrt(sum);
}

/** Retire les trames de la référence à plus de 40 dB sous la plus forte, dans les deux signaux. */
function removeSilentFrames(
  clean: Float32Array,
  degraded: Float32Array,
): [Float64Array, Float64Array] {
  const starts = frameStarts(clean.length);
  const energies = starts.map((s) => 20 * Math.log10(norm(windowed(clean, s)) + EPS));
  const max = Math.max(...energies);
  const kept = starts.filter((_, i) => max - DYN_RANGE_DB - energies[i] < 0);
  const length = kept.length === 0 ? 0 : (kept.length - 1) * HOP + FRAME;
  const outClean = new Float64Array(length);
  const outDegraded = new Float64Array(length);
  kept.forEach((start, k) => {
    const c = windowed(clean, start);
    const d = windowed(degraded, start);
    for (let i = 0; i < FRAME; i++) {
      outClean[k * HOP + i] += c[i];
      outDegraded[k * HOP + i] += d[i];
    }
  });
  return [outClean, outDegraded];
}

/** Spectre de puissance d'une trame (TFD directe sur les NFFT / 2 + 1 premières raies). */
function powerSpectrum(frame: Float64Array, cos: Float64Array, sin: Float64Array): Float64Array {
  const bins = NFFT / 2 + 1;
  const out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < FRAME; n++) {
      const index = (k * n) % NFFT;
      re += frame[n] * cos[index];
      im -= frame[n] * sin[index];
    }
    out[k] = re * re + im * im;
  }
  return out;
}

/** Raies de chaque bande de tiers d'octave (bornes comprises au début, exclues à la fin). */
function thirdOctaveBands(): [number, number][] {
  const freqs = Array.from({ length: NFFT / 2 + 1 }, (_, i) => (i * STOI_RATE) / NFFT);
  const nearest = (target: number) =>
    freqs.reduce((best, f, i) => ((f - target) ** 2 < (freqs[best] - target) ** 2 ? i : best), 0);
  return Array.from({ length: BANDS }, (_, k) => [
    nearest(MIN_FREQ * 2 ** ((2 * k - 1) / 6)),
    nearest(MIN_FREQ * 2 ** ((2 * k + 1) / 6)),
  ]);
}

/** Enveloppes en tiers d'octave : [bande][trame]. */
function bandEnvelopes(signal: Float64Array): Float64Array[] {
  const cos = Float64Array.from({ length: NFFT }, (_, i) => Math.cos((2 * Math.PI * i) / NFFT));
  const sin = Float64Array.from({ length: NFFT }, (_, i) => Math.sin((2 * Math.PI * i) / NFFT));
  const starts = frameStarts(signal.length);
  const bands = thirdOctaveBands();
  const out = bands.map(() => new Float64Array(starts.length));
  starts.forEach((start, t) => {
    const power = powerSpectrum(windowed(signal, start), cos, sin);
    bands.forEach(([low, high], b) => {
      let sum = 0;
      for (let k = low; k < high; k++) sum += power[k];
      out[b][t] = Math.sqrt(sum);
    });
  });
  return out;
}

function centeredUnit(values: Float64Array): Float64Array {
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const centered = values.map((v) => v - mean);
  const n = norm(centered) + EPS;
  return centered.map((v) => v / n);
}

/**
 * STOI de `degraded` par rapport à `clean`, signaux mono à 10 kHz de même longueur
 * et alignés dans le temps.
 */
export function stoi(clean: Float32Array, degraded: Float32Array): number {
  if (clean.length !== degraded.length) throw new Error('STOI : longueurs différentes');
  const [x, y] = removeSilentFrames(clean, degraded);
  const xBands = bandEnvelopes(x);
  const yBands = bandEnvelopes(y);
  const frames = xBands[0].length;
  if (frames < SEGMENT) throw new Error('STOI : signal trop court');
  const clip = 10 ** (-BETA_DB / 20);

  let total = 0;
  let count = 0;
  for (let m = SEGMENT; m <= frames; m++) {
    for (let b = 0; b < BANDS; b++) {
      const xSeg = xBands[b].subarray(m - SEGMENT, m);
      const ySeg = yBands[b].subarray(m - SEGMENT, m);
      const gain = norm(xSeg) / (norm(ySeg) + EPS);
      const yClipped = ySeg.map((v, i) => Math.min(v * gain, xSeg[i] * (1 + clip)));
      const xs = centeredUnit(Float64Array.from(xSeg));
      const ys = centeredUnit(yClipped);
      for (let i = 0; i < SEGMENT; i++) total += xs[i] * ys[i];
      count++;
    }
  }
  return total / count;
}

/**
 * Décalage (en échantillons) qui aligne `degraded` sur `clean`, cherché par corrélation
 * croisée sur les premières secondes, dans ±maxLag. Positif : `degraded` est en retard.
 */
export function findLag(clean: Float32Array, degraded: Float32Array, maxLag: number): number {
  const span = Math.min(clean.length, degraded.length, 10 * STOI_RATE) - maxLag;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = maxLag; i < span; i++) score += clean[i] * degraded[i + lag];
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/** Ramène `degraded` à la longueur et au calage de `clean`. */
export function align(clean: Float32Array, degraded: Float32Array, lag: number): Float32Array {
  const out = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i++) {
    const j = i + lag;
    out[i] = j >= 0 && j < degraded.length ? degraded[j] : 0;
  }
  return out;
}
