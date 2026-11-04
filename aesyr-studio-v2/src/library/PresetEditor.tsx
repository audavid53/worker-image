import type { ScenePreset } from "../../shared/library";
import { SHOT_SIZES } from "../../shared/shots";

type Path = (string | number)[];

function getAt(o: unknown, path: Path): unknown {
  return path.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)?.[k], o);
}
function setAt<T>(o: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const copy = (Array.isArray(o) ? [...(o as unknown[])] : { ...(o as object) }) as Record<string | number, unknown>;
  copy[k] = setAt(copy[k], rest, value);
  return copy as T;
}

const EASES: Record<ScenePreset["camera"]["ease"], (u: number) => number> = {
  linear: (u) => u,
  smoothstep: (u) => u * u * (3 - 2 * u),
  smootherstep: (u) => u * u * u * (u * (6 * u - 15) + 10),
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  spring: (u) => 1 - Math.cos(u * Math.PI * 2.5) * Math.exp(-5 * u),
  expoOut: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
};

/** The glide's easing curve plus how far a hold creeps in one second. */
function GlidePreview({ p }: { p: ScenePreset }) {
  const f = EASES[p.camera.ease];
  const pts = Array.from({ length: 41 }, (_, i) => {
    const u = i / 40;
    return `${8 + u * 184},${92 - f(u) * 80}`;
  }).join(" ");
  const [lo, hi] = p.camera.push_in_pct_per_frame;
  return (
    <figure className="lib-glide">
      <svg viewBox="0 0 200 100" role="img" aria-label={`${p.camera.ease} easing curve`}>
        <line x1="8" y1="92" x2="192" y2="92" className="axis" />
        <line x1="8" y1="12" x2="8" y2="92" className="axis" />
        <polyline points={pts} />
      </svg>
      <figcaption>
        {p.camera.ease} glide over {p.camera.glide_frames[0]}–{p.camera.glide_frames[1]} frames · holds creep {(lo * 24).toFixed(1)}–{(hi * 24).toFixed(1)}% per second at 24 fps
      </figcaption>
    </figure>
  );
}

export function PresetEditor({ value, readOnly, onChange }: { value: ScenePreset; readOnly: boolean; onChange: (p: ScenePreset) => void }) {
  const set = (path: Path, v: unknown) => onChange(setAt(value, path, v));
  const num = (path: Path, label: string, step = 1, hint?: string) => (
    <label className="field" title={hint}>
      <span>{label}</span>
      <input type="number" step={step} value={Number(getAt(value, path))} onChange={(e) => set(path, Number(e.target.value))} />
    </label>
  );
  const rng = (path: Path, label: string, step = 1) => {
    const [a, b] = getAt(value, path) as [number, number];
    return (
      <label className="field">
        <span>{label}</span>
        <span className="lib-range">
          <input type="number" step={step} aria-label={`${label} minimum`} value={a} onChange={(e) => set(path, [Number(e.target.value), b])} />
          –
          <input type="number" step={step} aria-label={`${label} maximum`} value={b} onChange={(e) => set(path, [a, Number(e.target.value)])} />
        </span>
      </label>
    );
  };
  const bool = (path: Path, label: string) => (
    <label className="lib-check">
      <input type="checkbox" checked={Boolean(getAt(value, path))} onChange={(e) => set(path, e.target.checked)} />
      {label}
    </label>
  );
  const text = (path: Path, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={String(getAt(value, path) ?? "")} onChange={(e) => set(path, e.target.value)} />
    </label>
  );
  const c = value.camera;
  const mix = c.hold_pct + c.drift_pct + c.move_pct;

  return (
    <fieldset className="lib-form" disabled={readOnly}>
      <div className="lib-grid">
        {text(["name"], "Name")}
        <label className="field lib-span2">
          <span>Description</span>
          <input value={value.blurb} onChange={(e) => set(["blurb"], e.target.value)} />
        </label>
      </div>

      <h3>Camera</h3>
      <GlidePreview p={value} />
      <div className="lib-grid">
        {num(["camera", "hold_pct"], "Hold %")}
        {num(["camera", "drift_pct"], "Drift %")}
        {num(["camera", "move_pct"], "Move %")}
        <p className="lib-note" data-bad={Math.abs(mix - 100) > 1 || undefined}>
          Screen time: {mix}% of 100
        </p>
        <label className="field">
          <span>Easing</span>
          <select value={c.ease} onChange={(e) => set(["camera", "ease"], e.target.value)}>
            {Object.keys(EASES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {rng(["camera", "glide_frames"], "Glide length (frames)")}
        {num(["camera", "peak_px_per_frame_720"], "Cut above (px/frame @720p)", 1, "A move faster than this becomes a cut")}
        {rng(["camera", "push_in_pct_per_frame"], "Push-in on holds (%/frame)", 0.05)}
        {num(["camera", "punch_pct_per_frame"], "Punch-word push (%/frame)", 0.05)}
        {num(["camera", "max_static_frames"], "Longest dead-still hold (frames)")}
        {rng(["camera", "roll", "deg"], "Roll (degrees)", 0.5)}
        {num(["camera", "roll", "frames"], "Roll length (frames)")}
        {num(["camera", "roll", "per_10s"], "Rolls per 10 s", 0.1)}
        {num(["camera", "kick", "px"], "Impact kick (px)", 0.5)}
        {num(["camera", "kick", "decay_frames"], "Kick decay (frames)")}
        {bool(["camera", "kick", "sign_flip_every_frame"], "Kick flips direction every frame")}
        {num(["camera", "whip", "per_min"], "Whip pans per minute", 0.05)}
        {rng(["camera", "whip", "px_per_frame"], "Whip speed (px/frame)")}
        {bool(["camera", "whip", "motion_blur"], "Motion blur on whips")}
        {num(["camera", "handheld"], "Hand-held float (0–1)", 0.05)}
      </div>

      <h3>Framing by shot size</h3>
      <table className="lib-framing">
        <thead>
          <tr>
            <th>Size</th>
            <th title="How many frame heights the full body spans">Body in frame</th>
            <th>Lens FOV (°)</th>
            <th title="Background blur at 1080 px">Blur (px)</th>
          </tr>
        </thead>
        <tbody>
          {SHOT_SIZES.map((s) => (
            <tr key={s.value}>
              <th scope="row" title={s.label}>
                {s.value}
              </th>
              {(["body_frames", "fov_deg", "lens_blur_px_1080"] as const).map((k) => (
                <td key={k}>
                  <input
                    type="number"
                    step={k === "body_frames" ? 0.05 : 1}
                    aria-label={`${s.value} ${k}`}
                    value={value.framing[s.value][k]}
                    onChange={(e) => set(["framing", s.value, k], Number(e.target.value))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Focus, sync and transitions</h3>
      <div className="lib-grid">
        <label className="field">
          <span>Focus on</span>
          <select value={value.focus} onChange={(e) => set(["focus"], e.target.value)}>
            <option value="eyes">eyes</option>
            <option value="subject">subject</option>
            <option value="none">none (all sharp)</option>
          </select>
        </label>
        {num(["foreground_props_share"], "Shots with foreground props (0–1)", 0.05)}
        {rng(["sync", "reaction_lead_frames"], "Reaction lands before its word (frames)")}
        <label className="field">
          <span>Cut on</span>
          <select value={value.sync.cut_on} onChange={(e) => set(["sync", "cut_on"], e.target.value)}>
            <option>word</option>
            <option>beat</option>
            <option>music</option>
          </select>
        </label>
        {text(["transitions", "default"], "Default transition")}
        {text(["transitions", "on_place_change"], "On a change of place")}
        {text(["transitions", "on_time_change"], "On a change of time")}
        {bool(["transitions", "flash_after_hook"], "White flash after the hook")}
      </div>

      <h3>Quality checks</h3>
      <div className="lib-grid">
        {num(["qa", "frozen_frames_max"], "Flag holds longer than (frames)")}
        {bool(["qa", "black_white_check"], "Flag black/white frames")}
        {bool(["qa", "speed_spike_check"], "Flag camera speed spikes")}
      </div>
      <label className="field">
        <span>Readability traps (one per line)</span>
        <textarea
          rows={4}
          value={value.readability_traps.join("\n")}
          onChange={(e) =>
            set(
              ["readability_traps"],
              e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      {value.evidence?.source && <p className="lib-evidence">Source: {value.evidence.source}</p>}
    </fieldset>
  );
}
