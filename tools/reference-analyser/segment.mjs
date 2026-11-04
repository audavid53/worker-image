// Shot segmentation + per-shot statistics from frames.json.
// usage: node segment.mjs <frames.json> <shots.json>
import { readFileSync, writeFileSync } from "node:fs";

const [inp, out] = process.argv.slice(2);
const { frames, fps } = JSON.parse(readFileSync(inp, "utf8"));
const N = frames.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

// Hard cut: diff spikes well above its neighbourhood and the motion model can't explain it.
const cuts = [0];
for (let i = 1; i < N; i++) {
  const d = frames[i].diff;
  const win = [];
  for (let j = Math.max(1, i - 12); j < Math.min(N, i + 12); j++) if (j !== i) win.push(frames[j].diff);
  const local = median(win);
  const resid = frames[i].mv?.resid ?? 0;
  if (d > 0.06 && d > local * 4 && resid > 6 && i - cuts.at(-1) >= 4) cuts.push(i);
}
// Soft transitions: runs of >= 6 frames whose diff sits clearly above the quiet baseline but no hard cut.
const soft = [];
for (let i = 1; i < N; ) {
  if (frames[i].diff > 0.02 && (frames[i].mv?.resid ?? 0) > 3) {
    let j = i;
    while (j < N && frames[j].diff > 0.015 && (frames[j].mv?.resid ?? 0) > 2.5) j++;
    if (j - i >= 6 && !cuts.some((c) => c >= i && c < j)) soft.push([i, j]);
    i = j + 1;
  } else i++;
}

const scale720 = 1280 / 854; // report speeds in px/frame at 1280-wide 720p
const shots = cuts.map((a, k) => {
  const b = (cuts[k + 1] ?? N) - 1;
  const fs = frames.slice(a, b + 1);
  const mv = fs.slice(1).map((f) => f.mv).filter(Boolean);
  const speed = mv.map((m) => Math.hypot(m.dx, m.dy) * scale720);
  const zoom = mv.map((m) => m.zoom_pct);
  const cls = mv.map((m, i) => (m.resid > 8 ? "change" : speed[i] < 0.3 && Math.abs(m.zoom_pct) < 0.05 ? "hold" : speed[i] < 2 && Math.abs(m.zoom_pct) < 0.3 ? "drift" : "move"));
  const count = (c) => cls.filter((x) => x === c).length;
  const sumDx = mv.reduce((s, m) => s + m.dx, 0), sumDy = mv.reduce((s, m) => s + m.dy, 0);
  const zoomTotal = zoom.reduce((s, z) => s * (1 + z / 100), 1);
  const mid = fs[Math.floor(fs.length / 2)];
  return {
    shot: k + 1,
    start_f: a,
    end_f: b,
    start_s: +(a / fps).toFixed(2),
    dur_s: +((b - a + 1) / fps).toFixed(2),
    frames: b - a + 1,
    luma: +median(fs.map((f) => f.luma)).toFixed(3),
    contrast: +(median(fs.map((f) => f.p95)) - median(fs.map((f) => f.p5))).toFixed(3),
    sat: +median(fs.map((f) => f.sat)).toFixed(3),
    colorful: +median(fs.map((f) => f.colorful)).toFixed(3),
    hue: mid.hue,
    hold_pct: mv.length ? Math.round((count("hold") / mv.length) * 100) : 0,
    drift_pct: mv.length ? Math.round((count("drift") / mv.length) * 100) : 0,
    move_pct: mv.length ? Math.round((count("move") / mv.length) * 100) : 0,
    change_pct: mv.length ? Math.round((count("change") / mv.length) * 100) : 0,
    median_speed_720: +median(speed).toFixed(2),
    peak_speed_720: +pct(speed, 0.95).toFixed(2),
    net_pan_px: [Math.round(sumDx), Math.round(sumDy)],
    net_zoom_pct: +((zoomTotal - 1) * 100).toFixed(1),
    median_zoom_pct_per_f: +median(zoom).toFixed(3),
  };
});

// Whole-film camera grammar (comparable to the Continuous glide preset).
const all = frames.slice(1).map((f) => f.mv).filter(Boolean);
const cutSet = new Set(cuts);
const usable = all.filter((m, i) => !cutSet.has(i + 1) && m.resid <= 8);
const sp = usable.map((m) => Math.hypot(m.dx, m.dy) * scale720);
const holdF = usable.filter((m, i) => sp[i] < 0.3 && Math.abs(m.zoom_pct) < 0.05).length;
const driftF = usable.filter((m, i) => !(sp[i] < 0.3 && Math.abs(m.zoom_pct) < 0.05) && sp[i] < 2 && Math.abs(m.zoom_pct) < 0.3).length;
const pushes = usable.map((m) => m.zoom_pct).filter((z) => Math.abs(z) >= 0.05);
const durations = shots.map((s) => s.dur_s);
const summary = {
  duration_s: +(N / fps).toFixed(2),
  shots: shots.length,
  cuts_per_10s: +((shots.length - 1) / (N / fps) * 10).toFixed(2),
  shot_len_s: { median: median(durations), p25: pct(durations, 0.25), p75: pct(durations, 0.75), min: Math.min(...durations), max: Math.max(...durations) },
  soft_transitions: soft.map(([a, b]) => ({ start_s: +(a / fps).toFixed(2), frames: b - a })),
  camera: {
    hold_pct: Math.round((holdF / usable.length) * 100),
    drift_pct: Math.round((driftF / usable.length) * 100),
    move_pct: Math.round(((usable.length - holdF - driftF) / usable.length) * 100),
    median_speed_720: +median(sp).toFixed(2),
    p90_speed_720: +pct(sp, 0.9).toFixed(2),
    zoom_active_frames_pct: Math.round((pushes.length / usable.length) * 100),
    push_in_share_of_zoom: pushes.length ? Math.round((pushes.filter((z) => z > 0).length / pushes.length) * 100) : 0,
    zoom_rate_median_pct_per_f: +median(pushes.map(Math.abs)).toFixed(3),
    zoom_rate_p90_pct_per_f: +pct(pushes.map(Math.abs), 0.9).toFixed(3),
  },
  look: {
    luma_median: +median(frames.map((f) => f.luma)).toFixed(3),
    sat_median: +median(frames.map((f) => f.sat)).toFixed(3),
    contrast_median: +(median(frames.map((f) => f.p95)) - median(frames.map((f) => f.p5))).toFixed(3),
  },
};
writeFileSync(out, JSON.stringify({ summary, shots }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log("shot  start  dur   luma  sat   hold/drift/move/chg  med/peak spd  zoom%  pan");
for (const s of shots) console.log(`${String(s.shot).padStart(3)} ${String(s.start_s).padStart(6)} ${String(s.dur_s).padStart(5)}  ${s.luma.toFixed(2)}  ${s.sat.toFixed(2)}  ${s.hold_pct}/${s.drift_pct}/${s.move_pct}/${s.change_pct}`.padEnd(58) + ` ${s.median_speed_720}/${s.peak_speed_720}`.padEnd(14) + ` ${s.net_zoom_pct}`.padEnd(8) + ` ${s.net_pan_px}`);
