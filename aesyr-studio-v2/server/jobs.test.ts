import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MotionJobs } from "./jobs";
import { saveModel } from "./media";
import { findBlender } from "./providers/blender-local";
import { estimateCost, MotionJobRequest } from "../shared/motion";

/** A minimal valid GLB header + JSON chunk, enough for the GLB sniff. */
const GLB = (() => {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }).padEnd(28, " "));
  const b = Buffer.alloc(20 + json.length);
  b.write("glTF", 0);
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12);
  b.write("JSON", 16);
  json.copy(b, 20);
  return new Uint8Array(b);
})();

type Route = (url: string, init?: RequestInit) => unknown;
function fakeFetch(routes: [RegExp, Route][], log: { url: string; body?: any }[]) {
  return (async (input: string, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response("nope", { status: 404 });
    const out = hit[1](url, init);
    return out instanceof Uint8Array ? new Response(out as BodyInit) : new Response(JSON.stringify(out));
  }) as unknown as typeof fetch;
}

async function withMedia(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "aesyr-jobs-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pollUntilDone(jobs: MotionJobs, id: string, max = 20) {
  for (let i = 0; i < max; i++) {
    const v = await jobs.get("u1", id);
    if (v.status !== "queued" && v.status !== "running") return v;
  }
  throw new Error("job never finished");
}

test("requests: presets must match the rig type; costs add up", () => {
  assert.equal(MotionJobRequest.safeParse({ kind: "tripo_character", prompt: "a fox", rigType: "quadruped", presets: ["walk"] }).success, false);
  const ok = MotionJobRequest.parse({ kind: "tripo_character", prompt: "a robot" });
  assert.deepEqual(ok.presets, ["idle", "walk", "run"]);
  assert.equal(estimateCost(ok), 30 + 25 + 10);
  const um = MotionJobRequest.parse({ kind: "unimate_motion", model: "https://x.test/a.glb", prompts: ["waves", "jumps"], takes: 2 });
  assert.equal(estimateCost(um), 4 * 2 * 2);
  assert.equal(MotionJobRequest.safeParse({ kind: "blender_motion", model: "../etc/passwd", recipe: { recipe: "merge-clips" } }).success, false);
  assert.equal(
    MotionJobRequest.safeParse({ kind: "blender_motion", model: "https://x.test/a.glb", recipe: { recipe: "keyframes", name: "k", duration: 1, loop: false, keys: [{ time: 0.5, position: [0, 1, 0] }, { time: 0.2, position: [0, 0, 0] }] } }).success,
    false,
  );
});

test("tripo character: model → rig → presets, outputs copied locally, credits kept", async () => {
  await withMedia(async (dir) => {
    const log: { url: string; body?: any }[] = [];
    const polls: Record<string, number> = {};
    const fetchImpl = fakeFetch(
      [
        [/\/generation\/text-to-model$/, () => ({ code: 0, data: { task_id: "t-model" } })],
        [/\/animations\/rig$/, () => ({ code: 0, data: { task_id: "t-rig" } })],
        [/\/animations\/retarget$/, () => ({ code: 0, data: { task_id: "t-anim" } })],
        [
          /\/tasks\/(t-\w+)$/,
          (url) => {
            const id = url.split("/").pop()!;
            polls[id] = (polls[id] ?? 0) + 1;
            return polls[id] < 2
              ? { code: 0, data: { status: "running", progress: 40 } }
              : { code: 0, data: { status: "success", progress: 100, output: { model_url: `https://cdn.test/${id}.glb` } } };
          },
        ],
        [/cdn\.test/, () => GLB],
      ],
      log,
    );
    const jobs = new MotionJobs({ env: { TRIPO_API_KEY: "k", MEDIA_DIR: dir }, fetchImpl });
    const created = await jobs.create("u1", { kind: "tripo_character", prompt: "a friendly robot mascot", presets: ["idle", "walk"] });
    assert.equal(created.status, "queued");
    assert.equal(await jobs.ledger.balance("u1"), 1000 - created.cost);
    const done = await pollUntilDone(jobs, created.id);
    assert.equal(done.status, "succeeded", done.error);
    assert.deepEqual(done.outputs.map((o) => o.role), ["model", "rigged", "animated"]);
    assert.deepEqual(done.outputs[2].clips, ["idle", "walk"]);
    assert.ok(done.outputs.every((o) => o.url.startsWith("/media/")));
    const rig = log.find((l) => l.url.endsWith("/animations/rig"))!.body;
    assert.equal(rig.input, "t-model");
    const retarget = log.find((l) => l.url.endsWith("/animations/retarget"))!.body;
    assert.deepEqual(retarget, { input: "t-rig", animations: ["preset:idle", "preset:walk"], out_format: "glb" });
    assert.equal(await jobs.ledger.balance("u1"), 1000 - created.cost); // charged, not refunded
  });
});

test("tripo out of credit: job fails with a clear message and the reserve is refunded", async () => {
  await withMedia(async (dir) => {
    const fetchImpl = fakeFetch([[/text-to-model/, () => ({ code: 2010, message: "no credit" })]], []);
    const jobs = new MotionJobs({ env: { TRIPO_API_KEY: "k", MEDIA_DIR: dir }, fetchImpl });
    const created = await jobs.create("u1", { kind: "tripo_character", prompt: "a cat", presets: [] });
    const done = await pollUntilDone(jobs, created.id);
    assert.equal(done.status, "failed");
    assert.match(done.error!, /out of credit/);
    assert.equal(await jobs.ledger.balance("u1"), 1000);
  });
});

test("unimate on RunPod: small local model goes inline; one output per motion", async () => {
  await withMedia(async (dir) => {
    const log: { url: string; body?: any }[] = [];
    let polls = 0;
    const b64 = Buffer.from(GLB).toString("base64");
    const fetchImpl = fakeFetch(
      [
        [/\/v2\/ep-uni\/run$/, () => ({ id: "rp-1", status: "IN_QUEUE" })],
        [
          /\/v2\/ep-uni\/status\/rp-1$/,
          () =>
            ++polls < 3
              ? { status: polls === 1 ? "IN_QUEUE" : "IN_PROGRESS" }
              : { status: "COMPLETED", output: { rig: {}, motions: [{ prompt: "An object waves.", take: 1, glb_b64: b64 }, { prompt: "An object jumps.", take: 1, glb_b64: b64 }] } },
        ],
      ],
      log,
    );
    const jobs = new MotionJobs({ env: { RUNPOD_API_KEY: "k", RUNPOD_UNIMATE_ENDPOINT_ID: "ep-uni", MEDIA_DIR: dir }, fetchImpl });
    const model = (await saveModel(GLB, { MEDIA_DIR: dir })).url;
    const created = await jobs.create("u1", { kind: "unimate_motion", model, prompts: ["waves", "jumps"] });
    const done = await pollUntilDone(jobs, created.id);
    assert.equal(done.status, "succeeded", done.error);
    assert.deepEqual(done.outputs.map((o) => o.prompt), ["An object waves.", "An object jumps."]);
    const sent = log.find((l) => l.url.endsWith("/run"))!.body;
    assert.equal(sent.input.model_b64, b64);
    assert.deepEqual(sent.input.prompts, ["waves", "jumps"]);
    assert.ok(sent.policy.executionTimeout > 0);
  });
});

test("worker-reported error fails the job and refunds", async () => {
  await withMedia(async (dir) => {
    const fetchImpl = fakeFetch(
      [
        [/\/run$/, () => ({ id: "rp-2" })],
        [/\/status\/rp-2$/, () => ({ status: "COMPLETED", output: { error: "The rig has 120 joints" } })],
      ],
      [],
    );
    const jobs = new MotionJobs({ env: { RUNPOD_API_KEY: "k", RUNPOD_UNIMATE_ENDPOINT_ID: "ep", MEDIA_DIR: dir }, fetchImpl });
    const created = await jobs.create("u1", { kind: "unimate_motion", model: "https://x.test/r.glb", prompts: ["walks forward"] });
    const done = await pollUntilDone(jobs, created.id);
    assert.equal(done.status, "failed");
    assert.match(done.error!, /120 joints/);
    assert.equal(await jobs.ledger.balance("u1"), 1000);
  });
});

test("not configured or not enough credits: refused before anything is reserved", async () => {
  const jobs = new MotionJobs({ env: { DEV_CREDITS: "3" } });
  await assert.rejects(jobs.create("u1", { kind: "tripo_character", prompt: "x" }), /TRIPO_API_KEY/);
  await assert.rejects(jobs.create("u1", { kind: "unimate_motion", model: "https://x.test/a.glb", prompts: ["waves"] }), /RUNPOD/);
  const tripo = new MotionJobs({ env: { TRIPO_API_KEY: "k", DEV_CREDITS: "3" } });
  await assert.rejects(tripo.create("u1", { kind: "tripo_character", prompt: "x" }), /Not enough credits/);
});

test("idempotency key returns the same job", async () => {
  const jobs = new MotionJobs({ env: { TRIPO_API_KEY: "k" } });
  const a = await jobs.create("u1", { kind: "tripo_character", prompt: "x", presets: [] }, "key-12345678");
  const b = await jobs.create("u1", { kind: "tripo_character", prompt: "x", presets: [] }, "key-12345678");
  assert.equal(a.id, b.id);
  assert.equal(await jobs.ledger.balance("u1"), 1000 - a.cost);
});

const blender = findBlender(process.env.BLENDER_PATH);
test("local Blender: object preset on a real model (skipped without Blender)", { skip: !blender && "Blender not installed", timeout: 180_000 }, async () => {
  await withMedia(async (dir) => {
    const cube = await readFile(join(import.meta.dirname, "fixtures", "cube.glb"));
    const model = (await saveModel(new Uint8Array(cube), { MEDIA_DIR: dir })).url;
    const jobs = new MotionJobs({ env: { MEDIA_DIR: dir } });
    const created = await jobs.create("u1", { kind: "blender_motion", model, recipe: { recipe: "object-preset", preset: "spin", name: "Spin", duration: 2, loop: true } });
    let v = await jobs.get("u1", created.id);
    for (let i = 0; i < 600 && (v.status === "running" || v.status === "queued"); i++) {
      await new Promise((r) => setTimeout(r, 250));
      v = await jobs.get("u1", created.id);
    }
    assert.equal(v.status, "succeeded", v.error);
    assert.deepEqual(v.outputs[0].clips, ["Spin"]);
  });
});
