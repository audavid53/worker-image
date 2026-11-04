import { useEffect, useRef } from "react";

/** Draws the visible part of a clip's source waveform (peaks span the whole source). */
export function Waveform({
  peaks,
  sourceIn,
  sourceLength,
  span,
  width,
  height,
}: {
  peaks: number[];
  sourceIn: number;
  sourceLength: number;
  span: number; // seconds of source shown (length × rate)
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || width < 2 || height < 2 || !peaks.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    g.fillStyle = getComputedStyle(c).color;
    const mid = height / 2;
    for (let x = 0; x < width; x += 2) {
      const t = sourceIn + (x / width) * span;
      const p = peaks[Math.min(peaks.length - 1, Math.floor((t / sourceLength) * peaks.length))] ?? 0;
      const h = Math.max(1, p * (height / 2 - 2));
      g.fillRect(x, mid - h, 1.4, h * 2);
    }
  }, [peaks, sourceIn, sourceLength, span, width, height]);
  return <canvas ref={ref} className="waveform" style={{ width, height }} aria-hidden />;
}
