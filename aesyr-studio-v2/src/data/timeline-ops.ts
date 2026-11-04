// Pure Director-timeline operations (unit-tested; no React). Every gesture is a function
// Work -> Work, so the UI can preview a drag from the gesture's starting state and undo/redo by
// keeping snapshots.
import { splitScenes, cueName, type ScriptElement } from "../../shared/screenplay";
import type { Shot } from "../../shared/shots";
import { TRACK_HEIGHT, TRACK_LABEL, type Clip, type TimelineDoc, type Track, type TrackKind } from "../../shared/timeline";

export const MIN_LEN = 0.1;
const EPS = 1e-6;

export interface Work {
  doc: TimelineDoc;
  /** The scene's shots in order. */
  shots: Shot[];
}

// ---------------------------------------------------------------------------
// shot track (derived)
// ---------------------------------------------------------------------------

export const shotTrack = (doc: TimelineDoc) => doc.tracks.find((t) => t.kind === "shot")!;

export function shotClips(w: Work): Clip[] {
  const track = shotTrack(w.doc);
  let t = 0;
  return w.shots.map((s) => {
    const c: Clip = { id: s.id, trackId: track.id, start: t, length: s.durationS, ref: { type: "shot", id: s.id }, props: { text: s.title } };
    t += s.durationS;
    return c;
  });
}

export const allClips = (w: Work): Clip[] => [...shotClips(w), ...w.doc.clips];

const q = (t: number, fps: number) => Math.round(t * fps) / fps;

/**
 * Writes a unified clip list back: shot clips become shot order + durations (packed, so gaps
 * close and overlaps reorder), everything else is quantised to frames.
 */
export function commit(w: Work, clips: Clip[], shots: Shot[] = w.shots): Work {
  const fps = w.doc.fps;
  const sid = shotTrack(w.doc).id;
  const byId = new Map(shots.map((s) => [s.id, s]));
  const nextShots = clips
    .filter((c) => c.trackId === sid)
    .sort((a, b) => a.start - b.start || a.length - b.length)
    .map((c) => ({ ...byId.get(c.id)!, durationS: Math.max(MIN_LEN, q(c.length, fps)) }))
    .filter((s) => s.id);
  const other = clips
    .filter((c) => c.trackId !== sid)
    .map((c) => ({ ...c, start: Math.max(0, q(c.start, fps)), length: Math.max(MIN_LEN, q(c.length, fps)) }))
    .sort((a, b) => a.start - b.start);
  return { shots: nextShots, doc: { ...w.doc, clips: other } };
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

export const end = (c: Clip) => c.start + c.length;
const trackOf = (w: Work, id: string) => w.doc.tracks.find((t) => t.id === id);
const kindOf = (w: Work, trackId: string) => trackOf(w, trackId)?.kind;

/** Dialogue and text clips may move between each other's tracks; everything else stays in kind. */
export const compatible = (a: TrackKind, b: TrackKind) => a === b || (["dialogue", "text"].includes(a) && ["dialogue", "text"].includes(b));

export const duration = (w: Work) => Math.max(0, ...allClips(w).map(end));

function neighbours(clips: Clip[], c: Clip, ignore: Set<string>) {
  const same = clips.filter((x) => x.trackId === c.trackId && !ignore.has(x.id));
  const prevEnd = Math.max(0, ...same.filter((x) => end(x) <= c.start + EPS).map(end));
  const nextStart = Math.min(Infinity, ...same.filter((x) => x.start >= end(c) - EPS).map((x) => x.start));
  return { prevEnd, nextStart };
}

export function fits(clips: Clip[], trackId: string, start: number, length: number, ignore: Set<string> = new Set()): boolean {
  if (start < -EPS) return false;
  return !clips.some((x) => x.trackId === trackId && !ignore.has(x.id) && x.start < start + length - EPS && end(x) > start + EPS);
}

// ---------------------------------------------------------------------------
// snapping
// ---------------------------------------------------------------------------

export function snapCandidates(w: Work, playhead: number, exclude: Set<string> = new Set()): number[] {
  const out = [0, playhead, ...w.doc.markers.map((m) => m.t)];
  if (w.doc.inPoint !== undefined) out.push(w.doc.inPoint);
  if (w.doc.outPoint !== undefined) out.push(w.doc.outPoint);
  for (const c of allClips(w)) if (!exclude.has(c.id)) out.push(c.start, end(c)); // includes dialogue line ends
  return out;
}

/** Nearest candidate within `threshold` seconds, else t. */
export function snap(t: number, candidates: number[], threshold: number): number {
  let best = t;
  let d = threshold;
  for (const c of candidates) {
    const dd = Math.abs(c - t);
    if (dd <= d) {
      d = dd;
      best = c;
    }
  }
  return best;
}

/** Snap a moving group: try each moving edge against the candidates, return the adjusted delta. */
export function snapDelta(edges: number[], dt: number, candidates: number[], threshold: number): number {
  let best = dt;
  let d = threshold;
  for (const e of edges) {
    const s = snap(e + dt, candidates, d);
    const dd = Math.abs(s - (e + dt));
    if (s !== e + dt && dd <= d) {
      d = dd;
      best = s - e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// move (and alt-duplicate)
// ---------------------------------------------------------------------------

/**
 * Moves the selected clips by dt (and optionally to another compatible track, for a single clip).
 * Free tracks clamp dt so nothing overlaps; the shot track reorders by the new positions.
 */
export function moveClips(w: Work, ids: string[], dt: number, opts: { toTrackId?: string; duplicate?: boolean; newId?: () => string } = {}): Work {
  const clips = allClips(w);
  const sid = shotTrack(w.doc).id;
  const moving = new Set(ids);
  const locked = new Set(w.doc.tracks.filter((t) => t.locked).map((t) => t.id));
  const sel = clips.filter((c) => moving.has(c.id) && !locked.has(c.trackId));
  if (!sel.length) return w;

  // Clamp against non-moving neighbours on free tracks (and the timeline start).
  let lo = -Infinity;
  let hi = Infinity;
  for (const c of sel) {
    lo = Math.max(lo, -c.start);
    if (c.trackId === sid || opts.duplicate) continue;
    const n = neighbours(clips, c, moving);
    lo = Math.max(lo, n.prevEnd - c.start);
    hi = Math.min(hi, n.nextStart - end(c));
  }
  if (opts.duplicate) {
    // Copies must land in free space; if they would not, keep the original positions.
    const copies = sel
      .filter((c) => c.trackId !== sid)
      .map((c) => ({ ...c, id: opts.newId!(), start: c.start + dt, ref: c.ref?.type === "shot" ? undefined : c.ref }));
    const ok = copies.every((c) => fits(clips, c.trackId, c.start, c.length));
    return ok ? commit(w, [...clips, ...copies]) : w;
  }
  const d = Math.min(hi, Math.max(lo, dt));

  let toTrack = opts.toTrackId && sel.length === 1 ? opts.toTrackId : undefined;
  if (toTrack) {
    const fromKind = kindOf(w, sel[0].trackId)!;
    const toKind = kindOf(w, toTrack);
    if (!toKind || locked.has(toTrack) || !compatible(fromKind, toKind) || !fits(clips, toTrack, sel[0].start + dt, sel[0].length, moving)) {
      toTrack = undefined;
    }
  }
  const next = clips.map((c) => {
    if (!moving.has(c.id) || locked.has(c.trackId)) return c;
    if (toTrack) return { ...c, trackId: toTrack, start: Math.max(0, c.start + dt) };
    return { ...c, start: c.start + d };
  });
  return commit(w, next);
}

// ---------------------------------------------------------------------------
// trim / stretch / roll
// ---------------------------------------------------------------------------

const isMedia = (c: Clip) => c.sourceLength !== undefined;

/**
 * Trims one edge by dt. Media clips are clamped to their source unless `stretch` (time-stretch:
 * the source span stays, the rate changes within 0.25×–4×). With `ripple`, later clips on the same
 * free track follow a right-edge trim. The shot track always ripples (it is packed).
 */
export function trimClip(w: Work, id: string, edge: "left" | "right", dt: number, opts: { stretch?: boolean; ripple?: boolean } = {}): Work {
  const clips = allClips(w);
  const c = clips.find((x) => x.id === id);
  if (!c || trackOf(w, c.trackId)?.locked) return w;
  const sid = shotTrack(w.doc).id;
  const free = c.trackId !== sid;
  const n = neighbours(clips, c, new Set([c.id]));
  const rate = c.rate ?? 1;
  let u: Clip = c;

  if (edge === "right") {
    let len = Math.max(MIN_LEN, c.length + dt);
    if (free && !opts.ripple) len = Math.min(len, n.nextStart - c.start);
    if (isMedia(c) && !opts.stretch) len = Math.min(len, (c.sourceLength! - (c.sourceIn ?? 0)) / rate);
    if (isMedia(c) && opts.stretch) {
      const span = c.length * rate;
      len = Math.min(span / 0.25, Math.max(span / 4, len));
      u = { ...c, length: len, rate: span / len };
    } else u = { ...c, length: len };
    const delta = u.length - c.length;
    const next = clips.map((x) => {
      if (x.id === c.id) return u;
      if (free && opts.ripple && x.trackId === c.trackId && x.start >= end(c) - EPS) return { ...x, start: x.start + delta };
      return x;
    });
    return commit(w, next);
  }

  // left edge: the clip's end stays put
  let d = Math.min(dt, c.length - MIN_LEN);
  d = Math.max(d, -c.start);
  if (free) d = Math.max(d, n.prevEnd - c.start);
  if (isMedia(c) && !opts.stretch) d = Math.max(d, -(c.sourceIn ?? 0) / rate);
  if (isMedia(c) && opts.stretch) {
    const span = c.length * rate;
    const len = Math.min(span / 0.25, Math.max(span / 4, c.length - d));
    d = c.length - len;
    u = { ...c, start: c.start + d, length: len, rate: span / len };
  } else {
    u = { ...c, start: c.start + d, length: c.length - d, sourceIn: isMedia(c) ? (c.sourceIn ?? 0) + d * rate : c.sourceIn };
  }
  return commit(
    w,
    clips.map((x) => (x.id === c.id ? u : x)),
  );
}

/** Rolling edit: moves the cut between two touching clips on one track. */
export function rollEdit(w: Work, leftId: string, rightId: string, dt: number): Work {
  const clips = allClips(w);
  const a = clips.find((x) => x.id === leftId);
  const b = clips.find((x) => x.id === rightId);
  if (!a || !b || a.trackId !== b.trackId || Math.abs(end(a) - b.start) > 1e-3 || trackOf(w, a.trackId)?.locked) return w;
  let d = Math.max(-(a.length - MIN_LEN), Math.min(b.length - MIN_LEN, dt));
  if (isMedia(a)) d = Math.min(d, (a.sourceLength! - (a.sourceIn ?? 0)) / (a.rate ?? 1) - a.length);
  if (isMedia(b)) d = Math.max(d, -(b.sourceIn ?? 0) / (b.rate ?? 1));
  const next = clips.map((x) => {
    if (x.id === a.id) return { ...a, length: a.length + d };
    if (x.id === b.id) return { ...b, start: b.start + d, length: b.length - d, sourceIn: isMedia(b) ? (b.sourceIn ?? 0) + d * (b.rate ?? 1) : b.sourceIn };
    return x;
  });
  return commit(w, next);
}

/** The clip that touches `c` on the given side, if any (for rolling edits). */
export function touching(w: Work, c: Clip, side: "left" | "right"): Clip | undefined {
  return allClips(w).find((x) => x.trackId === c.trackId && x.id !== c.id && (side === "right" ? Math.abs(x.start - end(c)) < 1e-3 : Math.abs(end(x) - c.start) < 1e-3));
}

// ---------------------------------------------------------------------------
// blade, delete, copy/paste, add
// ---------------------------------------------------------------------------

/** Splits clips under time t (shot clips split into two shots). */
export function splitAt(w: Work, ids: string[], t: number, newId: () => string): Work {
  const clips = allClips(w);
  let shots = w.shots;
  const out: Clip[] = [];
  for (const c of clips) {
    if (!ids.includes(c.id) || trackOf(w, c.trackId)?.locked || t <= c.start + MIN_LEN || t >= end(c) - MIN_LEN) {
      out.push(c);
      continue;
    }
    const left = t - c.start;
    const rid = newId();
    out.push({ ...c, length: left });
    out.push({
      ...c,
      id: rid,
      start: t,
      length: c.length - left,
      sourceIn: isMedia(c) ? (c.sourceIn ?? 0) + left * (c.rate ?? 1) : c.sourceIn,
      ref: c.ref?.type === "shot" ? { type: "shot", id: rid } : c.ref,
    });
    if (c.ref?.type === "shot") {
      const i = shots.findIndex((s) => s.id === c.id);
      shots = [...shots.slice(0, i + 1), { ...shots[i], id: rid, title: `${shots[i].title} (b)`, status: "draft" }, ...shots.slice(i + 1)];
    }
  }
  return commit(w, out, shots);
}

export function deleteClips(w: Work, ids: string[], ripple: boolean): Work {
  const clips = allClips(w);
  const gone = clips.filter((c) => ids.includes(c.id) && !trackOf(w, c.trackId)?.locked);
  const goneIds = new Set(gone.map((c) => c.id));
  const sid = shotTrack(w.doc).id;
  let next = clips.filter((c) => !goneIds.has(c.id));
  if (ripple) {
    for (const g of gone.filter((x) => x.trackId !== sid).sort((a, b) => b.start - a.start)) {
      next = next.map((c) => (c.trackId === g.trackId && c.start >= end(g) - EPS ? { ...c, start: c.start - g.length } : c));
    }
  }
  return commit(
    w,
    next,
    w.shots.filter((s) => !goneIds.has(s.id)),
  );
}

export interface Clipboard {
  clips: Clip[]; // relative: earliest start = 0
}

export function copyClips(w: Work, ids: string[]): Clipboard {
  const sid = shotTrack(w.doc).id;
  const sel = w.doc.clips.filter((c) => ids.includes(c.id) && c.trackId !== sid);
  const t0 = Math.min(...sel.map((c) => c.start));
  return { clips: sel.map((c) => ({ ...c, start: c.start - t0 })) };
}

/** Pastes at t on the same tracks; a clip that would overlap is pushed past what it hits. */
export function paste(w: Work, cb: Clipboard, t: number, newId: () => string): { work: Work; ids: string[] } {
  let clips = allClips(w);
  const ids: string[] = [];
  for (const c of cb.clips) {
    if (!trackOf(w, c.trackId) || trackOf(w, c.trackId)!.locked) continue;
    let start = t + c.start;
    for (let guard = 0; guard < 200 && !fits(clips, c.trackId, start, c.length); guard++) {
      const hit = clips.find((x) => x.trackId === c.trackId && x.start < start + c.length - EPS && end(x) > start + EPS)!;
      start = end(hit);
    }
    const id = newId();
    ids.push(id);
    clips = [...clips, { ...c, id, start }];
  }
  return { work: commit(w, clips), ids };
}

/** Adds a clip on a free track at the first free spot at or after `start`. */
export function addClip(w: Work, trackId: string, start: number, length: number, props: Clip["props"], newId: () => string, extra: Partial<Clip> = {}): { work: Work; id: string } {
  const clips = allClips(w);
  let s = Math.max(0, start);
  for (let guard = 0; guard < 200 && !fits(clips, trackId, s, length); guard++) {
    const hit = clips.find((x) => x.trackId === trackId && x.start < s + length - EPS && end(x) > s + EPS)!;
    s = end(hit);
  }
  const id = newId();
  return { work: commit(w, [...clips, { id, trackId, start: s, length, props, ...extra }]), id };
}

export const updateClipProps = (w: Work, id: string, props: Partial<Clip["props"]>): Work => ({
  ...w,
  doc: { ...w.doc, clips: w.doc.clips.map((c) => (c.id === id ? { ...c, props: { ...c.props, ...props } } : c)) },
});

// ---------------------------------------------------------------------------
// tracks, markers, range
// ---------------------------------------------------------------------------

export function addTrack(w: Work, kind: TrackKind, newId: () => string): Work {
  if (kind === "shot") return w;
  const n = w.doc.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = { id: newId(), kind, name: `${TRACK_LABEL[kind]} ${n}`, height: TRACK_HEIGHT.default, locked: false, muted: false };
  return { ...w, doc: { ...w.doc, tracks: [...w.doc.tracks, track] } };
}

export const updateTrack = (w: Work, id: string, t: Partial<Track>): Work => ({
  ...w,
  doc: {
    ...w.doc,
    tracks: w.doc.tracks.map((x) =>
      x.id === id ? { ...x, ...t, height: Math.round(Math.min(TRACK_HEIGHT.max, Math.max(TRACK_HEIGHT.min, t.height ?? x.height))) } : x,
    ),
  },
});

export const toggleMarker = (w: Work, t: number, newId: () => string): Work => {
  const hit = w.doc.markers.find((m) => Math.abs(m.t - t) < 0.05);
  return {
    ...w,
    doc: {
      ...w.doc,
      markers: hit ? w.doc.markers.filter((m) => m !== hit) : [...w.doc.markers, { id: newId(), t: q(t, w.doc.fps), label: "" }].sort((a, b) => a.t - b.t),
    },
  };
};

export const setRange = (w: Work, r: { inPoint?: number; outPoint?: number }): Work => {
  const fq = (t: number | undefined) => (t === undefined ? undefined : q(t, w.doc.fps));
  const doc = { ...w.doc, ...("inPoint" in r ? { inPoint: fq(r.inPoint) } : {}), ...("outPoint" in r ? { outPoint: fq(r.outPoint) } : {}) };
  if (doc.inPoint !== undefined && doc.outPoint !== undefined && doc.inPoint > doc.outPoint) [doc.inPoint, doc.outPoint] = [doc.outPoint, doc.inPoint];
  return { ...w, doc };
};

// ---------------------------------------------------------------------------
// seed and export
// ---------------------------------------------------------------------------

export function newTimeline(sceneId: string, newId: () => string, fps = 24): TimelineDoc {
  const kinds: TrackKind[] = ["shot", "camera", "motion", "dialogue", "text", "audio"];
  return {
    sceneId,
    fps,
    tracks: kinds.map((k) => ({ id: newId(), kind: k, name: TRACK_LABEL[k], height: k === "audio" ? 56 : TRACK_HEIGHT.default, locked: false, muted: false })),
    clips: [],
    markers: [],
  };
}

/** Seeds camera notes per shot and the scene's dialogue lines (aligned to the shot that speaks them). */
export function seedTimeline(doc: TimelineDoc, script: ScriptElement[], shots: Shot[], wps: number, newId: () => string): TimelineDoc {
  const scene = splitScenes(script).find((s) => s.id === doc.sceneId);
  let w: Work = { doc, shots };
  const cam = doc.tracks.find((t) => t.kind === "camera")!;
  const dia = doc.tracks.find((t) => t.kind === "dialogue")!;
  for (const c of shotClips(w)) {
    const s = shots.find((x) => x.id === c.id)!;
    w = addClip(w, cam.id, c.start, c.length, { text: `${s.size} · ${s.movement}` }, newId, { ref: { type: "shot", id: s.id } }).work;
  }
  if (scene) {
    const els = scene.elements;
    let cursor = 0;
    for (let i = 0; i < els.length; i++) {
      if (els[i].type !== "character") continue;
      const lines: string[] = [];
      for (let j = i + 1; j < els.length && (els[j].type === "dialogue" || els[j].type === "parenthetical"); j++) if (els[j].type === "dialogue") lines.push(els[j].text);
      const text = lines.join(" ");
      if (!text) continue;
      const len = Math.max(1, Math.round(((text.match(/\S+/g)?.length ?? 0) / wps) * 10) / 10);
      const shot = shotClips(w).find((c) => shots.find((s) => s.id === c.id)?.description === text);
      const at = shot ? shot.start : cursor;
      const r = addClip(w, dia.id, at, len, { text, speaker: cueName(els[i].text) }, newId, { ref: { type: "line", id: els[i].id } });
      w = r.work;
      cursor = end(w.doc.clips.find((c) => c.id === r.id)!);
    }
  }
  return w.doc;
}

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** SubRip captions from dialogue and text tracks (muted tracks excluded), offset by the scene start. */
export function toSrt(w: Work, offset = 0): string {
  const ids = new Set(w.doc.tracks.filter((t) => (t.kind === "dialogue" || t.kind === "text") && !t.muted).map((t) => t.id));
  return w.doc.clips
    .filter((c) => ids.has(c.trackId) && c.props.text?.trim())
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(offset + c.start)} --> ${srtTime(offset + end(c))}\n${c.props.speaker ? `${c.props.speaker.toUpperCase()}: ` : ""}${c.props.text!.trim()}\n`)
    .join("\n");
}
