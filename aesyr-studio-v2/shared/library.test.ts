import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NarrativeStructure, ScenePreset, firstIssue } from "./library";
import { NARRATIVES } from "./narratives";
import { SCENE_PRESETS } from "./scene-presets";
import { librarySeedSql } from "../scripts/library-sql";

const glide = SCENE_PRESETS.find((p) => p.id === "continuous-glide")!;

test("every built-in validates and ids are unique", () => {
  for (const n of NARRATIVES) assert.ok(NarrativeStructure.safeParse(n).success, n.id);
  for (const p of SCENE_PRESETS) assert.ok(ScenePreset.safeParse(p).success, p.id);
  const ids = [...NARRATIVES, ...SCENE_PRESETS].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("seeded continuous-glide keeps the measured camera grammar", () => {
  assert.deepEqual(glide.camera.glide_frames, [18, 40]);
  assert.deepEqual(glide.camera.push_in_pct_per_frame, [0.15, 0.35]);
  assert.equal(glide.camera.ease, "smootherstep");
  assert.equal(glide.camera.max_static_frames, 4);
  assert.equal(glide.framing.WS.lens_blur_px_1080, 0, "wides stay sharp");
  assert.equal(SCENE_PRESETS.find((p) => p.id === "motion-graphics")!.status, "draft");
});

test("narratives: shares must sum to 100% and beat keys must be unique", () => {
  const fact = NARRATIVES.find((n) => n.id === "fact-short")!;
  const bad = NarrativeStructure.safeParse({ ...fact, beats: fact.beats.map((b) => ({ ...b, share: b.share / 2 })) });
  assert.match(firstIssue(bad)!, /add up to 100%/);
  const dup = NarrativeStructure.safeParse({ ...fact, beats: fact.beats.map((b) => ({ ...b, key: "same" })) });
  assert.match(firstIssue(dup)!, /unique/);
  const range = NarrativeStructure.safeParse({ ...fact, runtime: { min_s: 60, default_s: 30, max_s: 90 } });
  assert.match(firstIssue(range)!, /between min and max/);
});

test("presets: screen-time mix must sum to 100% and ranges must be ordered", () => {
  const mix = ScenePreset.safeParse({ ...glide, camera: { ...glide.camera, move_pct: 10 } });
  assert.match(firstIssue(mix)!, /add up to 100%/);
  const rng = ScenePreset.safeParse({ ...glide, camera: { ...glide.camera, glide_frames: [40, 18] } });
  assert.match(firstIssue(rng)!, /min must not exceed max/);
  const missing = ScenePreset.safeParse({ ...glide, framing: { ...glide.framing, CU: undefined } });
  assert.equal(missing.success, false, "every shot size needs a framing row");
});

test("the newest library_builtins migration matches the code (regenerate after changing a built-in)", () => {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), "supabase", "migrations");
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith("_library_builtins.sql"))
    .sort()
    .at(-1)!;
  assert.equal(readFileSync(join(dir, newest), "utf8").replace(/\r\n/g, "\n"), librarySeedSql(), `${newest} is stale: run npx tsx scripts/library-sql.ts > a new migration`);
});
