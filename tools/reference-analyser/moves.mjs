// Camera-move events and background colour track.
// usage: node moves.mjs <frames.json> <shots.json> <ffmpeg.exe> <video> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [framesPath, shotsPath, ff, video, out] = process.argv.slice(2);
const { frames, fps } = JSON.parse(readFileSync(framesPath, "utf8"));
const { shots } = JSON.parse(readFileSync(shotsPath, "utf8"));
const cutAt = new Set(shots.map((s) => s.start_f));
const k720 = 1280 / 854;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

// ---- move events: runs of frames with real camera motion (zoom or pan), not content changes
const active = frames.map((f, i) => {
  const m = f.mv;
  if (!m || cutAt.has(i) || m.resid > 8) return false;
  return Math.abs(m.zoom_pct) >= 0.25 || Math.hypot(m.dx, m.dy) * k720 >= 2;
});
const events = [];
for (let i = 0; i < frames.length; ) {
  if (!active[i]) { i++; continue; }
  let j = i;
  while (j < frames.length && (active[j] || (active[j + 1] && j + 1 - i < 200))) j++; // bridge 1-frame gaps
  if (j - i >= 3) {
    const seg = frames.slice(i, j).map((f) => f.mv);
    const zoomRates = seg.map((m) => m.zoom_pct);
    const speeds = seg.map((m) => Math.hypot(m.dx, m.dy) * k720);
    const totalZoom = (seg.reduce((s, m) => s * (1 + m.zoom_pct / 100), 1) - 1) * 100;
    const mag = seg.map((m, q) => Math.abs(m.zoom_pct) * 20 + speeds[q]); // combined magnitude
    const peakAt = mag.indexOf(Math.max(...mag));
    const peak = mag[peakAt];
    const first10 = mag.findIndex((v) => v >= peak * 0.1);
    let last10 = mag.length - 1;
    while (last10 > 0 && mag[last10] < peak * 0.1) last10--;
    events.push({
      start_s: +(i / fps).toFixed(2),
      frames: j - i,
      kind: Math.abs(totalZoom) > 3 ? (totalZoom > 0 ? "push-in" : "pull-out") : "pan",
      total_zoom_pct: +totalZoom.toFixed(1),
      pan_px_720: [Math.round(seg.reduce((s, m) => s + m.dx, 0) * k720), Math.round(seg.reduce((s, m) => s + m.dy, 0) * k720)],
      peak_zoom_pct_per_f: +Math.max(...zoomRates.map(Math.abs)).toFixed(2),
      peak_speed_720: +Math.max(...speeds).toFixed(1),
      attack_f: peakAt - Math.max(0, first10),
      release_f: last10 - peakAt,
    });
  }
  i = j + 1;
}

// ---- background colour: median of the top and bottom 4% rows (where UI/type rarely sits)
const W = 96, H = 54;
const r = spawnSync(ff, ["-v", "error", "-i", video, "-vf", `fps=4,scale=${W}:${H}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
const raw = r.stdout;
const F = W * H * 3;
const bg = [];
for (let o = 0, t = 0; o + F <= raw.length; o += F, t += 0.25) {
  const px = [];
  for (const y of [0, 1, H - 2, H - 1]) for (let x = 0; x < W; x++) { const i = o + (y * W + x) * 3; px.push([raw[i], raw[i + 1], raw[i + 2]]); }
  const ch = (c) => median(px.map((p) => p[c]));
  const hex = "#" + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("");
  bg.push({ t, hex });
}
// collapse runs of similar colour
const near = (a, b) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 10; };
const bgRuns = [];
for (const b of bg) { const last = bgRuns.at(-1); if (last && near(last.hex, b.hex)) last.until = b.t; else bgRuns.push({ from: b.t, until: b.t, hex: b.hex }); }

const zoomEv = events.filter((e) => e.kind !== "pan");
const summary = {
  move_events: events.length,
  per_10s: +(events.length / (frames.length / fps) * 10).toFixed(2),
  frames: { median: median(events.map((e) => e.frames)), p25: pct(events.map((e) => e.frames), 0.25), p75: pct(events.map((e) => e.frames), 0.75) },
  zoom_moves: zoomEv.length,
  push_in: zoomEv.filter((e) => e.kind === "push-in").length,
  pull_out: zoomEv.filter((e) => e.kind === "pull-out").length,
  total_zoom_abs_median_pct: median(zoomEv.map((e) => Math.abs(e.total_zoom_pct))),
  peak_zoom_rate_median: median(zoomEv.map((e) => e.peak_zoom_pct_per_f)),
  attack_median_f: median(events.map((e) => e.attack_f)),
  release_median_f: median(events.map((e) => e.release_f)),
};
writeFileSync(out, JSON.stringify({ summary, events, background: bgRuns.filter((b) => b.until - b.from >= 0.5) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log("start  frames kind      zoom%   pan720      peak z%/f  peak px/f  attack/release");
for (const e of events) console.log(`${String(e.start_s).padStart(5)} ${String(e.frames).padStart(5)}  ${e.kind.padEnd(9)} ${String(e.total_zoom_pct).padStart(6)}  ${JSON.stringify(e.pan_px_720).padEnd(12)} ${String(e.peak_zoom_pct_per_f).padStart(6)}   ${String(e.peak_speed_720).padStart(7)}     ${e.attack_f}/${e.release_f}`);
console.log("\nbackground runs (>= 0.5 s):");
for (const b of bgRuns.filter((b) => b.until - b.from >= 0.5)) console.log(`  ${b.from.toFixed(2)}–${b.until.toFixed(2)}s ${b.hex}`);
