import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenplay } from "../../shared/screenplay";
import type { Shot } from "../../shared/shots";
import type { Clip } from "../../shared/timeline";
import {
  addClip,
  addTrack,
  allClips,
  copyClips,
  deleteClips,
  moveClips,
  newTimeline,
  paste,
  rollEdit,
  seedTimeline,
  setRange,
  shotClips,
  snap,
  snapCandidates,
  snapDelta,
  splitAt,
  toggleMarker,
  toSrt,
  touching,
  trimClip,
  updateTrack,
  type Work,
} from "./timeline-ops";

let n = 0;
const id = () => `id${n++}`;

const shot = (sid: string, d: number, extra: Partial<Shot> = {}): Shot => ({
  id: sid,
  sceneId: "S",
  title: sid,
  description: "",
  durationS: d,
  size: "MS",
  view: "Front view",
  angle: "Eye level",
  movement: "Static",
  castIds: [],
  status: "draft",
  note: "",
  ...extra,
});

function work(): Work {
  const doc = newTimeline("S", id);
  return { doc, shots: [shot("a", 2), shot("b", 3), shot("c", 1)] };
}
const track = (w: Work, kind: string) => w.doc.tracks.find((t) => t.kind === kind)!.id;
const clip = (w: Work, cid: string) => allClips(w).find((c) => c.id === cid)!;
const withText = (w: Work, kind: string, start: number, length: number) => addClip(w, track(w, kind), start, length, { text: "x" }, id);
function withAudio(w: Work, start: number, length: number, sourceLength: number, sourceIn = 0) {
  return addClip(w, track(w, "audio"), start, length, { name: "a.wav" }, id, { sourceLength, sourceIn, rate: 1 });
}

// ----- shot track -----

test("shot track is derived and packed from the shots", () => {
  const w = work();
  assert.deepEqual(
    shotClips(w).map((c) => [c.id, c.start, c.length]),
    [
      ["a", 0, 2],
      ["b", 2, 3],
      ["c", 5, 1],
    ],
  );
});

test("moving a shot clip reorders shots", () => {
  const w = moveClips(work(), ["c"], -5.5);
  assert.deepEqual(
    w.shots.map((s) => s.id),
    ["c", "a", "b"],
  );
});

test("trimming a shot's right edge changes its duration and ripples later shots", () => {
  const w = trimClip(work(), "a", "right", 1);
  assert.equal(w.shots[0].durationS, 3);
  assert.equal(clip(w, "b").start, 3);
});

test("rolling the cut between two shots keeps the total length", () => {
  const w = rollEdit(work(), "a", "b", 0.5);
  assert.deepEqual(
    w.shots.map((s) => s.durationS),
    [2.5, 2.5, 1],
  );
  assert.equal(touching(w, clip(w, "a"), "right")?.id, "b");
});

test("blade splits a shot into two shots", () => {
  const w = splitAt(work(), ["b"], 3, id);
  assert.equal(w.shots.length, 4);
  assert.deepEqual(
    w.shots.map((s) => s.durationS),
    [2, 1, 2, 1],
  );
  assert.match(w.shots[2].title, /\(b\)$/);
});

// ----- free tracks -----

test("free clips cannot overlap: move clamps to the neighbour", () => {
  let w = work();
  const a = withText(w, "text", 0, 2);
  w = a.work;
  const b = withText(w, "text", 5, 2);
  w = b.work;
  w = moveClips(w, [a.id], 10);
  assert.equal(clip(w, a.id).start, 3, "stops where the next clip starts");
  w = moveClips(w, [a.id], -10);
  assert.equal(clip(w, a.id).start, 0, "never before zero");
});

test("moving to a compatible track only (dialogue <-> text), and only into free space", () => {
  let w = work();
  const a = withText(w, "dialogue", 0, 2);
  w = moveClips(a.work, [a.id], 1, { toTrackId: track(a.work, "text") });
  assert.equal(clip(w, a.id).trackId, track(w, "text"));
  const w2 = moveClips(w, [a.id], 0, { toTrackId: track(w, "audio") });
  assert.equal(clip(w2, a.id).trackId, track(w, "text"), "audio is not compatible");
});

test("alt-drag duplicates into free space", () => {
  let w = work();
  const a = withText(w, "text", 0, 2);
  w = moveClips(a.work, [a.id], 4, { duplicate: true, newId: id });
  const texts = w.doc.clips.filter((c) => c.trackId === track(w, "text"));
  assert.deepEqual(
    texts.map((c) => c.start),
    [0, 4],
  );
});

test("group move keeps relative spacing and clamps as a group", () => {
  let w = work();
  const a = withText(w, "text", 1, 1);
  const b = withText(a.work, "camera", 3, 1);
  w = moveClips(b.work, [a.id, b.id], -5);
  assert.equal(clip(w, a.id).start, 0);
  assert.equal(clip(w, b.id).start, 2);
});

test("trim on free tracks clamps to neighbours; ripple pushes later clips instead", () => {
  let w = work();
  const a = withText(w, "text", 0, 2);
  const b = withText(a.work, "text", 3, 1);
  w = trimClip(b.work, a.id, "right", 5);
  assert.equal(clip(w, a.id).length, 3, "stops at the next clip");
  const r = trimClip(b.work, a.id, "right", 2, { ripple: true });
  assert.equal(clip(r, a.id).length, 4);
  assert.equal(clip(r, b.id).start, 5, "rippled by +2");
});

test("left trim keeps the end; media clips cannot trim past their source", () => {
  let w = work();
  const m = withAudio(w, 2, 4, 6, 1); // source 6s, starts 1s in
  w = trimClip(m.work, m.id, "left", -3);
  const c = clip(w, m.id);
  assert.equal(c.sourceIn, 0, "only 1s of source before the in-point");
  assert.equal(c.start, 1);
  assert.equal(c.length, 5);
  const r = trimClip(m.work, m.id, "right", 10);
  assert.equal(clip(r, m.id).length, 5, "6s source - 1s in-point");
});

test("shift-trim time-stretches media within 0.25x–4x", () => {
  const m = withAudio(work(), 0, 4, 4);
  const w = trimClip(m.work, m.id, "right", 4, { stretch: true });
  const c = clip(w, m.id);
  assert.equal(c.length, 8);
  assert.equal(c.rate, 0.5);
  const max = trimClip(m.work, m.id, "right", 100, { stretch: true });
  assert.equal(clip(max, m.id).rate, 0.25);
});

test("rolling edit on free tracks respects media source limits", () => {
  let w = work();
  const a = withAudio(w, 0, 2, 2); // fully used source: can't extend
  w = a.work;
  const b = withText(w, "audio", 2, 2);
  w = rollEdit(b.work, a.id, b.id, 1);
  assert.equal(clip(w, a.id).length, 2);
  w = rollEdit(b.work, a.id, b.id, -1);
  assert.equal(clip(w, a.id).length, 1);
  assert.equal(clip(w, b.id).start, 1);
});

test("delete with and without ripple", () => {
  let w = work();
  const a = withText(w, "text", 0, 2);
  const b = withText(a.work, "text", 2, 1);
  w = deleteClips(b.work, [a.id], false);
  assert.equal(clip(w, b.id).start, 2);
  w = deleteClips(b.work, [a.id], true);
  assert.equal(clip(w, b.id).start, 0);
  w = deleteClips(b.work, ["b"], false);
  assert.deepEqual(
    w.shots.map((s) => s.id),
    ["a", "c"],
    "deleting a shot clip deletes the shot",
  );
});

test("split media keeps the source offset", () => {
  const m = withAudio(work(), 1, 4, 10, 2);
  const w = splitAt(m.work, [m.id], 2, id);
  const parts = w.doc.clips.filter((c) => c.trackId === track(w, "audio"));
  assert.deepEqual(
    parts.map((c) => [c.start, c.length, c.sourceIn]),
    [
      [1, 1, 2],
      [2, 3, 3],
    ],
  );
});

test("copy and paste at the playhead, pushed past anything in the way", () => {
  let w = work();
  const a = withText(w, "text", 0, 2);
  const b = withText(a.work, "text", 5, 2);
  w = b.work;
  const cb = copyClips(w, [a.id]);
  const r = paste(w, cb, 4, id);
  assert.equal(clip(r.work, r.ids[0]).start, 7, "4 overlaps 5–7, so it lands at 7");
});

test("snapping to edges, the playhead and markers", () => {
  let w = work();
  w = toggleMarker(w, 4.2, id);
  const cands = snapCandidates(w, 1.3);
  assert.equal(snap(2.04, cands, 0.1), 2, "shot edge");
  assert.equal(snap(1.36, cands, 0.1), 1.3, "playhead");
  assert.equal(Math.round(snap(4.15, cands, 0.1) * 100) / 100, 4.21, "marker (frame-quantised)");
  assert.equal(snap(3.5, cands, 0.1), 3.5, "nothing near");
  assert.equal(Math.round(snapDelta([0, 2], 0.95, [3], 0.1) * 100) / 100, 1, "end edge snaps to 3");
});

test("markers toggle; in/out range is ordered", () => {
  let w = toggleMarker(work(), 2, id);
  assert.equal(w.doc.markers.length, 1);
  w = toggleMarker(w, 2.01, id);
  assert.equal(w.doc.markers.length, 0);
  w = setRange(w, { inPoint: 5, outPoint: 2 });
  assert.deepEqual([w.doc.inPoint, w.doc.outPoint], [2, 5]);
  w = setRange(w, { outPoint: 9.000065 });
  assert.equal(w.doc.outPoint, 9, "quantised to frames");
  assert.equal(w.doc.inPoint, 2, "untouched");
});

test("tracks: add, resize within limits, lock blocks edits", () => {
  let w = addTrack(work(), "audio", id);
  assert.equal(w.doc.tracks.filter((t) => t.kind === "audio").length, 2);
  w = updateTrack(w, track(w, "text"), { height: 999 });
  assert.equal(w.doc.tracks.find((t) => t.kind === "text")!.height, 200);
  const a = withText(w, "text", 0, 1);
  const locked = updateTrack(a.work, track(a.work, "text"), { locked: true });
  assert.equal(clip(moveClips(locked, [a.id], 2), a.id).start, 0);
});

test("seed: camera note per shot, dialogue aligned to the shot that speaks it", () => {
  const script = parseScreenplay("EXT. HARBOUR - DAWN\n\nMist.\n\nMATEO\nShe kept the light on.\n\nMASTER\nFor who?", id);
  const sceneId = script[0].id;
  const shots = [shot("w", 3, { sceneId }), shot("m", 2, { sceneId, description: "She kept the light on." }), shot("h", 2, { sceneId, description: "For who?" })];
  const doc = seedTimeline(newTimeline(sceneId, id), script, shots, 2.5, id);
  const w: Work = { doc, shots };
  const cams = doc.clips.filter((c: Clip) => c.trackId === track(w, "camera"));
  assert.equal(cams.length, 3);
  const lines = doc.clips.filter((c: Clip) => c.trackId === track(w, "dialogue"));
  assert.deepEqual(
    lines.map((c) => [c.start, c.props.speaker]),
    [
      [3, "Mateo"],
      [5, "Master"],
    ],
  );
  assert.match(toSrt(w, 10), /^1\n00:00:13,000 --> 00:00:15,000\nMATEO: She kept the light on\.\n/);
});
