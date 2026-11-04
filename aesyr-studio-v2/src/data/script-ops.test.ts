import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreenplay } from "../../shared/screenplay";
import { castLinks, matchKey, scriptFromDraft, syncCast } from "./script-ops";
import type { Beat, Character } from "./project";

let n = 0;
const id = () => `id${n++}`;
const char = (cid: string, name: string): Character => ({ id: cid, name, role: "", description: "", want: "", need: "", arc: "", x: 0, y: 0 });

const SCRIPT = `EXT. LIGHTHOUSE - DUSK

Marta climbs the stairs. Ivy watches.

MATEO (V.O.)
Thank you, keeper.

INT. LAMP ROOM - NIGHT

MARTA
Again.

STRANGER
Who's there?`;

test("matching ignores case and notes in parentheses", () => {
  assert.equal(matchKey("Mateo (voice)"), matchKey("MATEO"));
});

test("cast links scenes to characters (speakers and action mentions) and locations", () => {
  const script = parseScreenplay(SCRIPT, id);
  const chars = [char("m", "Marta"), char("i", "Ivy"), char("t", "Mateo (voice)")];
  const links = castLinks(script, chars, [{ id: "env1", name: "Lighthouse", description: "" }]);
  assert.deepEqual(links.appearances.m, [1, 2]);
  assert.deepEqual(links.appearances.i, [1], "named in action only");
  assert.deepEqual(links.appearances.t, [1], "V.O. speaker matches '(voice)' card");
  assert.deepEqual(links.appearances.env1, [1]);
  assert.deepEqual(links.unmatchedCharacters, ["Stranger"]);
  assert.deepEqual(links.unmatchedLocations, ["Lamp Room"]);
});

test("sync adds cards for unmatched speakers and locations only", () => {
  const script = parseScreenplay(SCRIPT, id);
  const r = syncCast(script, [char("m", "Marta")], [], id);
  assert.deepEqual(
    r.characters.map((c) => c.name),
    ["Marta", "Mateo", "Stranger"],
  );
  assert.deepEqual(
    r.environments.map((e) => e.name),
    ["Lighthouse", "Lamp Room"],
  );
  const again = syncCast(script, r.characters, r.environments, id);
  assert.equal(again.added, 0, "idempotent");
});

test("generated scenes become headings linked to beats", () => {
  const beats: Beat[] = [{ id: "b1", key: "ki", act: "Ki", name: "Intro", summary: "", color: 4, targetSeconds: 10 }];
  const { script, sceneMeta } = scriptFromDraft(
    { scenes: [{ heading: "ext. isle - day", beat_key: "ki", elements: [{ type: "action", text: "Waves." }] }] },
    beats,
    id,
  );
  assert.equal(script[0].type, "heading");
  assert.equal(script[0].text, "EXT. ISLE - DAY");
  assert.deepEqual(sceneMeta[script[0].id], { beatId: "b1", color: 4 });
});
