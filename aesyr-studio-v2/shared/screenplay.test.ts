import { test } from "node:test";
import assert from "node:assert/strict";
import { breakdown, cueName, looksLikeScreenplay, parseHeading, parseScreenplay, splitScenes } from "./screenplay";

let n = 0;
const id = () => `e${n++}`;

const SCRIPT = `INT. MINES OF MORIA - NIGHT

Torches flicker. The fellowship runs.

GANDOLF
Fly, you fools!

FRODA (V.O.)
(whispering)
He's not coming.
Not this time.

CUT TO:

EXT. BRIDGE - CONTINUOUS

The bridge sways.

GANDOLF
Keep moving.`;

test("detects screenplays vs prose ideas", () => {
  assert.equal(looksLikeScreenplay(SCRIPT), true);
  assert.equal(looksLikeScreenplay("A lighthouse keeper lights a lamp every night."), false);
});

test("parses elements and splits scenes", () => {
  const els = parseScreenplay(SCRIPT, id);
  assert.deepEqual(
    els.map((e) => e.type),
    ["heading", "action", "character", "dialogue", "character", "parenthetical", "dialogue", "transition", "heading", "action", "character", "dialogue"],
  );
  assert.equal(els[6].text, "He's not coming. Not this time.", "multi-line speech merged");
  const scenes = splitScenes(els);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].heading.text, "EXT. BRIDGE - CONTINUOUS");
});

test("breakdown finds cast and location per scene", () => {
  const [s1, s2] = splitScenes(parseScreenplay(SCRIPT, id));
  assert.deepEqual(breakdown(s1).characters, ["Gandolf", "Froda"]);
  assert.equal(breakdown(s1).location, "Mines Of Moria");
  assert.equal(breakdown(s1).time, "Night");
  assert.deepEqual(breakdown(s2).characters, ["Gandolf"]);
});

test("prose before the first heading goes into an untitled scene", () => {
  const els = parseScreenplay("Some prose.\n\nINT. ROOM - DAY\n\nA chair.", id);
  assert.equal(els[0].type, "heading");
  assert.equal(els[0].text, "");
  assert.equal(splitScenes(els).length, 2);
});

test("heading and cue helpers", () => {
  assert.deepEqual(parseHeading("INT./EXT. CAR - MOVING - DAY"), { place: "INT/EXT", location: "Car", time: "Moving - Day" });
  assert.deepEqual(parseHeading("EXT. LIGHTHOUSE"), { place: "EXT", location: "Lighthouse", time: "" });
  assert.equal(cueName("PRIVATE JONES (CONT'D)"), "Private Jones");
});
