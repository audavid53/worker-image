// Deterministic timing helpers: every visual is a pure function of the frame, so a shot renders
// identically in preview and in the final frame-by-frame export.

export const FPS = 24;
export const BEAT = 12; // frames per beat at 120 BPM (measured)

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Snap in, settle fast: the measured move envelope (attack ~2 f, release ~3 f over a 7 f move). */
export const expoOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(u)));
/** Pop with a small overshoot (type and UI reactions). */
export const backOut = (u: number, s = 1.70158) => {
  const x = clamp01(u) - 1;
  return x * x * ((s + 1) * x + s) + 1;
};
export const easeInOut = (u: number) => {
  const x = clamp01(u);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** 0 → 1 between frames a and b with an easing. */
export const span = (f: number, a: number, b: number, ease: (u: number) => number = expoOut) => ease((f - a) / Math.max(1, b - a));

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Piecewise keys: value at frame f from [frame, value] keys, each segment eased. */
export function keys(f: number, k: [number, number][], ease: (u: number) => number = expoOut): number {
  if (f <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (f <= k[i][0]) return lerp(k[i - 1][1], k[i][1], span(f, k[i - 1][0], k[i][0], ease));
  }
  return k[k.length - 1][1];
}

/** Quadratic bezier point for cursor arcs. */
export function arc(u: number, from: [number, number], to: [number, number], bend = 0.2): [number, number] {
  const mx = (from[0] + to[0]) / 2 - (to[1] - from[1]) * bend;
  const my = (from[1] + to[1]) / 2 + (to[0] - from[0]) * bend;
  const v = 1 - u;
  return [v * v * from[0] + 2 * v * u * mx + u * u * to[0], v * v * from[1] + 2 * v * u * my + u * u * to[1]];
}
