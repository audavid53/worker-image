import { test } from "node:test";
import assert from "node:assert/strict";
import { draftToState, type ProjectMeta } from "./project";

const meta: ProjectMeta = {
  name: "T",
  aspectRatio: "16:9",
  narrativeId: "three-act",
  scenePresetId: "continuous-glide",
  runtimeSeconds: 100,
  idea: "x",
  logline: "",
};

const character = (name: string) => ({ name, role: "", description: "", want: "", need: "", arc: "" });

test("relationships keep one link per pair and drop unknown names", () => {
  const s = draftToState(meta, {
    logline: "L",
    beats: [{ key: "a", act: "1", name: "A", summary: "", share: 0.25 }],
    characters: [character("Captain"), character("Private Jones")],
    relationships: [
      { from: "Captain", to: "Private Jones", label: "commands" },
      { from: "private jones", to: "captain", label: "obeys" },
      { from: "Captain", to: "The Bridge", label: "crosses" },
      { from: "Captain", to: "Captain", label: "self" },
    ],
  });
  assert.equal(s.relationships.length, 1);
  assert.equal(s.relationships[0].label, "commands");
  assert.equal(s.beats[0].targetSeconds, 25, "share × runtime");
  assert.equal(s.meta?.logline, "L");
});
