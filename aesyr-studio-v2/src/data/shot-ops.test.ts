import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenplay } from "../../shared/screenplay";
import type { Shot } from "../../shared/shots";
import { connect, disconnect, draftShots, fmtTime, moveShot, shotTimings } from "./shot-ops";
import type { Character } from "./project";

let n = 0;
const id = () => `id${n++}`;
const char = (cid: string, name: string): Character => ({ id: cid, name, role: "", description: "", want: "", need: "", arc: "", x: 0, y: 0 });

const SCRIPT = `EXT. HARBOUR - DAWN

Mist over the water. Mateo ties up his boat.

MATEO
She kept the light on all these years.

HARBOUR MASTER
(gruff)
For who?

Mateo runs up the path toward the lighthouse.

INT. LAMP ROOM - NIGHT

MARTA (V.O.)
For anyone.`;

const chars = [char("m", "Mateo"), char("h", "Harbour Master"), char("t", "Marta")];
const envs = [{ id: "harb", name: "Harbour", description: "" }];

test("drafts an establishing wide, a shot per speech and per extra action", () => {
  const script = parseScreenplay(SCRIPT, id);
  const shots = draftShots(script, chars, envs, [], 2.5, id);
  const s1 = shots.filter((s) => s.sceneId === script[0].id);
  assert.deepEqual(
    s1.map((s) => [s.size, s.view, s.movement]),
    [
      ["WS", "Front view", "Static"],
      ["MCU", "Three-quarter", "Static"],
      ["MCU", "Over-the-shoulder", "Static"],
      ["MS", "Three-quarter", "Tracking shot"],
    ],
  );
  assert.deepEqual(s1[0].castIds, ["m"], "named in the establishing action");
  assert.equal(s1[0].locationId, "harb");
  assert.deepEqual(s1[2].castIds, ["h"]);
  assert.equal(s1[1].durationS, 3.2, "8 words at 2.5 wps");
  const vo = shots.find((s) => s.title === "Marta (voice)")!;
  assert.deepEqual(vo.castIds, [], "voice-over is not on screen");
});

test("only drafts scenes without shots", () => {
  const script = parseScreenplay(SCRIPT, id);
  const first = draftShots(script, chars, envs, [], 2.5, id);
  const keepScene1 = first.filter((s) => s.sceneId === script[0].id);
  const again = draftShots(script, chars, envs, keepScene1, 2.5, id);
  assert.ok(again.length > 0 && again.every((s) => s.sceneId !== script[0].id));
});

const shot = (sid: string, sceneId: string, d = 2): Shot => ({
  id: sid,
  sceneId,
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
});

test("timings follow scene order then shot order", () => {
  const script = parseScreenplay("INT. A - DAY\n\nx\n\nINT. B - DAY\n\ny", id);
  const [a, b] = script.filter((e) => e.type === "heading").map((e) => e.id);
  // stored out of scene order on purpose
  const t = shotTimings(script, [shot("b1", b, 4), shot("a1", a, 3), shot("a2", a, 1.5)]);
  assert.deepEqual(t.a1, { start: 0, number: "1.1" });
  assert.deepEqual(t.a2, { start: 3, number: "1.2" });
  assert.deepEqual(t.b1, { start: 4.5, number: "2.1" });
  assert.equal(fmtTime(64.5), "1:04.5");
});

test("moving shots within and across scenes", () => {
  const list = [shot("a1", "A"), shot("a2", "A"), shot("b1", "B")];
  assert.deepEqual(moveShot(list, "a2", "A", "a1").map((s) => s.id), ["a2", "a1", "b1"]);
  const across = moveShot(list, "a1", "B", null);
  assert.deepEqual(across.map((s) => s.id), ["a2", "b1", "a1"]);
  assert.equal(across[2].sceneId, "B");
});

test("connecting cast and locations to shots", () => {
  let s = shot("x", "A");
  s = connect(s, { kind: "character", id: "c1" });
  s = connect(s, { kind: "character", id: "c1" });
  s = connect(s, { kind: "environment", id: "e1" });
  assert.deepEqual(s.castIds, ["c1"]);
  assert.equal(s.locationId, "e1");
  s = disconnect(disconnect(s, { kind: "character", id: "c1" }), { kind: "environment", id: "e1" });
  assert.deepEqual(s.castIds, []);
  assert.equal(s.locationId, undefined);
});
