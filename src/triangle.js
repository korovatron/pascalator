// Binomial coefficient computation, caching, magnitude estimation and
// display-formatting helpers.
//
// Strategy:
//  - Exact values use native BigInt (fast, no external dependency).
//  - For rows small enough to be affordable (<= EXACT_ROW_LIMIT) we cache the
//    whole row so every visible label in that row is free after the first
//    computation.
//  - For anything else (astronomically large rows) we only ever need the
//    *order of magnitude*, which we get from a log-gamma (Lanczos)
//    approximation - this is O(1) and works at any row, however large.
//  - The info card, on click, may compute one single exact value on demand
//    (independent of the row cache) up to a higher row limit, since a single
//    C(n, k) is O(n) BigInt multiplications rather than O(n^2) for a full row.

export const EXACT_ROW_LIMIT = 4000; // rows at/below this may have their full row cached as BigInt
export const INFOCARD_EXACT_LIMIT = 20000; // rows at/below this can compute one exact value on click
const MAX_CACHED_ROWS = 400; // LRU cap on cached BigInt rows

// ---------------------------------------------------------------------------
// Exact BigInt computation
// ---------------------------------------------------------------------------

const rowCache = new Map(); // n -> BigInt[] (length n+1), Map preserves insertion order for LRU

/** Returns the full row n as an array of BigInt, using an LRU cache. */
export function getExactRow(n) {
  if (n > EXACT_ROW_LIMIT) return null;

  const cached = rowCache.get(n);
  if (cached) {
    // Refresh LRU position.
    rowCache.delete(n);
    rowCache.set(n, cached);
    return cached;
  }

  const row = new Array(n + 1);
  row[0] = 1n;
  let c = 1n;
  for (let k = 0; k < n; k++) {
    c = (c * BigInt(n - k)) / BigInt(k + 1);
    row[k + 1] = c;
  }

  rowCache.set(n, row);
  if (rowCache.size > MAX_CACHED_ROWS) {
    const oldestKey = rowCache.keys().next().value;
    rowCache.delete(oldestKey);
  }
  return row;
}

/**
 * Computes a single C(n, k) exactly via BigInt, independent of the row
 * cache. O(min(k, n-k)) multiplications - usable for larger n than
 * getExactRow() since it doesn't materialise the whole row.
 */
export function computeExactValue(n, k) {
  k = Math.min(k, n - k);
  if (k < 0) return 0n;
  let c = 1n;
  for (let i = 0; i < k; i++) {
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Magnitude estimation via log-gamma (Lanczos approximation)
// ---------------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function, via the Lanczos approximation. */
function lgamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  const t = x + LANCZOS_G + 0.5;
  let a = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_COEFFICIENTS[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const LN10 = Math.LN10;

/** Approximate log10(C(n, k)), valid for any n, k with 0 <= k <= n. */
export function log10Binomial(n, k) {
  if (k <= 0 || k >= n) return 0;
  return (lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)) / LN10;
}

// ---------------------------------------------------------------------------
// Colour mapping (used to shade cells by magnitude, at every zoom level)
// ---------------------------------------------------------------------------

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** Exported for reuse wherever else a hue (0-360) needs converting to RGB, e.g. the animated cell highlight. */
export { hslToRgb };

/** RGB for cell magnitude t in [0, 1]: a full ROYGBIV sweep, violet/blue (small) through to red (row max). */
function magnitudeRgb(t) {
  t = Math.min(1, Math.max(0, t));
  const hue = 270 * (1 - t);
  return hslToRgb(hue, 0.85, 0.5);
}

/** Maps t in [0, 1] to an "rgb(r, g, b)" colour string along the ROYGBIV spectrum. */
export function magnitudeColor(t) {
  const { r, g, b } = magnitudeRgb(t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Whether cell magnitude t renders as a visually light colour (for choosing contrasting text/outlines). */
export function magnitudeIsLight(t) {
  const { r, g, b } = magnitudeRgb(t);
  const perceived = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return perceived > 0.55;
}

/** Colour for cell (n, k), normalised against the maximum value in its row. */
export function colorForCell(n, k) {
  if (n <= 0) return magnitudeColor(1);
  const rowMaxLog = log10Binomial(n, Math.floor(n / 2));
  if (rowMaxLog <= 0) return magnitudeColor(1);
  const t = log10Binomial(n, k) / rowMaxLog;
  return magnitudeColor(t);
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Scientific notation string ("1.23e45") built from an exact digit string, to a given number of significant figures. */
export function scientificFromDigitString(digits, sigFigs) {
  const exponent = digits.length - 1;
  const fracLen = Math.max(0, Math.min(sigFigs - 1, digits.length - 1));
  const mantissa = fracLen > 0 ? `${digits[0]}.${digits.slice(1, 1 + fracLen)}` : digits[0];
  return `${mantissa}e${exponent}`;
}

/** Scientific notation string built from an approximate log10 value. */
export function scientificFromLog10(log10Value, sigFigs = 3) {
  if (!isFinite(log10Value)) return "0";
  let exponent = Math.floor(log10Value);
  let mantissa = Math.pow(10, log10Value - exponent);
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa.toFixed(Math.max(0, sigFigs - 1))}e${exponent}`;
}

/** Exact digit string for cell (n, k), or null if the row is too large to have been cached. */
export function getExactDigits(n, k) {
  const exactRow = getExactRow(n);
  return exactRow ? exactRow[k].toString() : null;
}

/** Digit count of C(n, k) - exact when cheap, else estimated from log10. */
export function digitCount(n, k) {
  const exactRow = getExactRow(n);
  if (exactRow) return exactRow[k].toString().length;
  return Math.floor(log10Binomial(n, k)) + 1;
}

// ---------------------------------------------------------------------------
// Named sequences (for describing highlighted rows/diagonals)
// ---------------------------------------------------------------------------

// The diagonal with one index fixed at p (0-based) runs C(p,p), C(p+1,p), C(p+2,p), ...
// - these are the classic figurate numbers, one dimension higher for each p.
const DIAGONAL_SEQUENCE_NAMES = [
  "constant sequence of 1s",
  "natural numbers (1, 2, 3, 4, ...)",
  "triangular numbers (1, 3, 6, 10, 15, ...)",
  "tetrahedral numbers (1, 4, 10, 20, 35, ...)",
  "pentatope numbers (1, 5, 15, 35, 70, ...)",
  "5-simplex numbers (1, 6, 21, 56, 126, ...)",
];

/** Human-friendly name for the Pascal's-triangle diagonal with one index fixed at p (0-based). */
export function diagonalSequenceName(p) {
  if (p < 0) return null;
  if (p < DIAGONAL_SEQUENCE_NAMES.length) return DIAGONAL_SEQUENCE_NAMES[p];
  return `${p}-simplex numbers`;
}

/** Describes a highlight selection ({type, n, k}) in human terms, naming the sequence where recognised. */
export function describeSelection(selection) {
  if (!selection) return null;
  const { type, n, k } = selection;
  if (type === "row") {
    return `Row ${n} of Pascal's triangle (sum = 2^${n})`;
  }
  if (type === "diagSwNe") {
    return `SW\u2013NE diagonal (k = ${k}): ${diagonalSequenceName(k)}`;
  }
  if (type === "diagNwSe") {
    const j = n - k;
    return `NW\u2013SE diagonal (n \u2212 k = ${j}): ${diagonalSequenceName(j)}`;
  }
  return null;
}
