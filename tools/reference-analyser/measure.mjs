// Per-frame measurement of a video: luma/contrast/saturation/hue, frame difference (cuts),
// and global camera motion (pan x/y in source px per frame, zoom % per frame) by block search.
// usage: node measure.mjs <ffmpeg.exe> <video> <out.json>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [ff, video, out] = process.argv.slice(2);
const W = 160, H = 90; // analysis size
const SRC_W = 854; // source width, to report motion in source pixels
const MW = 80, MH = 45; // motion size
const proc = spawn(ff, ["-v", "error", "-i", video, "-vf", `scale=${W}:${H}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
const FRAME = W * H * 3;
let buf = Buffer.alloc(0);
const frames = [];
let prevGray = null, prevSmall = null;

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}

function downsample(gray) {
  const s = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * 2 * W + x * 2;
    s[y * MW + x] = (gray[i] + gray[i + 1] + gray[i + W] + gray[i + W + 1]) / 4;
  }
  return s;
}

// Sample b at (x,y) bilinear.
const sample = (img, x, y) => {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= MW - 1 || y0 >= MH - 1) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * MW + x0;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + MW] * (1 - fx) * fy + img[i + MW + 1] * fx * fy;
};

/** Best (dx, dy, scale) mapping prev -> cur: cur(x) ≈ prev((x - c)/s + c - d). Coarse-to-fine search. */
function motion(prev, cur) {
  const cx = MW / 2, cy = MH / 2;
  const cost = (dx, dy, s) => {
    let e = 0, n = 0;
    for (let y = 4; y < MH - 4; y += 1) for (let x = 4; x < MW - 4; x += 1) {
      const v = sample(prev, (x - cx) / s + cx - dx, (y - cy) / s + cy - dy);
      if (Number.isNaN(v)) continue;
      e += Math.abs(cur[y * MW + x] - v);
      n++;
    }
    return n > 200 ? e / n : Infinity;
  };
  let best = { dx: 0, dy: 0, s: 1, c: cost(0, 0, 1) };
  const still = best.c;
  for (const step of [1, 0.5, 0.25]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [ddx, ddy, ds] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, step * 0.01], [0, 0, -step * 0.01]]) {
        const c = cost(best.dx + ddx, best.dy + ddy, best.s + ds);
        if (c < best.c - 1e-6) { best = { dx: best.dx + ddx, dy: best.dy + ddy, s: best.s + ds, c }; improved = true; }
      }
      if (Math.abs(best.dx) > 12 || Math.abs(best.dy) > 8) break;
    }
  }
  return { ...best, still };
}

function analyse(f) {
  const gray = new Float32Array(W * H);
  let sumL = 0, sumS = 0;
  const lumas = [];
  const hueBins = new Array(12).fill(0);
  for (let i = 0, p = 0; i < FRAME; i += 3, p++) {
    const r = f[i], g = f[i + 1], b = f[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    gray[p] = l; sumL += l; lumas.push(l);
    const [h, s, v] = hsv(r, g, b);
    sumS += s;
    if (s > 0.25 && v > 0.2) hueBins[Math.floor(h / 30)]++;
  }
  lumas.sort((a, b) => a - b);
  const n = W * H;
  let diff = null;
  if (prevGray) { let d = 0; for (let p = 0; p < n; p++) d += Math.abs(gray[p] - prevGray[p]); diff = d / n; }
  const small = downsample(gray);
  let mv = null;
  if (prevSmall) {
    const m = motion(prevSmall, small);
    const k = SRC_W / MW; // motion px -> source px
    mv = { dx: +(m.dx * k).toFixed(2), dy: +(m.dy * k).toFixed(2), zoom_pct: +((m.s - 1) * 100).toFixed(3), resid: +m.c.toFixed(2), still: +m.still.toFixed(2) };
  }
  prevGray = gray; prevSmall = small;
  return {
    luma: +(sumL / n / 255).toFixed(4),
    p5: +(lumas[Math.floor(n * 0.05)] / 255).toFixed(3),
    p95: +(lumas[Math.floor(n * 0.95)] / 255).toFixed(3),
    sat: +(sumS / n).toFixed(4),
    colorful: +(hueBins.reduce((a, b) => a + b, 0) / n).toFixed(4),
    hue: hueBins.indexOf(Math.max(...hueBins)) * 30 + 15,
    diff: diff === null ? null : +(diff / 255).toFixed(4),
    mv,
  };
}

proc.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= FRAME) {
    frames.push(analyse(buf.subarray(0, FRAME)));
    buf = buf.subarray(FRAME);
    if (frames.length % 240 === 0) process.stderr.write(`${frames.length} frames\n`);
  }
});
proc.on("close", (code) => {
  writeFileSync(out, JSON.stringify({ fps: 24, width: 854, height: 480, frames }));
  process.stderr.write(`done ${frames.length} frames (ffmpeg exit ${code})\n`);
});
