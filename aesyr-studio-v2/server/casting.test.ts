import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCode3D, generateImage, generateScript } from "./casting";
import { ApiError } from "./openai";

const openaiReply = (data: unknown, capture?: (body: any) => void) =>
  (async (_url: string, init: RequestInit) => {
    capture?.(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }] }),
    );
  }) as unknown as typeof fetch;

const scriptReq = {
  projectName: "Lantern",
  narrativeId: "kishotenketsu",
  runtimeSeconds: 90,
  logline: "L",
  beats: [{ key: "ki", name: "Introduction", summary: "Marta lights the lamp.", targetSeconds: 22.5 }],
  characters: [{ name: "Marta", description: "Old keeper" }],
};

test("script: needs an OpenAI key and a valid request", async () => {
  await assert.rejects(generateScript(scriptReq, {}), /OPENAI_API_KEY/);
  await assert.rejects(generateScript({ ...scriptReq, beats: [] }, { OPENAI_API_KEY: "k" }), (e) => e instanceof ApiError && e.status === 400);
});

test("script: sends the outline and cast; returns validated scenes", async () => {
  let sent: any;
  const draft = {
    scenes: [
      {
        heading: "EXT. LIGHTHOUSE - DUSK",
        beat_key: "ki",
        elements: [
          { type: "action", text: "Marta climbs the stairs." },
          { type: "character", text: "MARTA" },
          { type: "dialogue", text: "Again." },
        ],
      },
    ],
  };
  const r = await generateScript(scriptReq, { OPENAI_API_KEY: "k" }, openaiReply(draft, (b) => (sent = b)));
  assert.match(sent.input, /\[ki\] Introduction \(22\.5s\): Marta lights the lamp\./);
  assert.match(sent.input, /- Marta: Old keeper/);
  assert.equal(sent.text.format.schema.properties.scenes.items.properties.elements.items.properties.type.enum.includes("heading"), false);
  assert.equal(r.draft.scenes[0].elements.length, 3);
});

test("code3d: clamps sizes, fixes vector length and bad colours", async () => {
  const spec = {
    height_m: 1.8,
    parts: [{ name: "body", shape: "capsule", size: [0.5, 999], position: [0, 1, 0, 7], rotation: [0, 0, 0], color: "red" }],
  };
  const r = await generateCode3D({ kind: "character", name: "Marta", description: "Old keeper" }, { OPENAI_API_KEY: "k" }, openaiReply(spec));
  assert.deepEqual(r.spec.parts[0].size, [0.5, 50, 0.5]);
  assert.deepEqual(r.spec.parts[0].position, [0, 1, 0]);
  assert.equal(r.spec.parts[0].color, "#8a8f98");
});

test("image: needs a Google key; saves the returned image under /media", async () => {
  const req = { kind: "character", name: "Marta", description: "Old keeper", aspectRatio: "16:9" };
  await assert.rejects(generateImage(req, {}), /GOOGLE_API_KEY/);

  const dir = await mkdtemp(join(tmpdir(), "aesyr-media-"));
  let headers: Record<string, string> = {};
  let body: any;
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    headers = init.headers as Record<string, string>;
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
  }) as unknown as typeof fetch;
  try {
    const r = await generateImage(req, { GOOGLE_API_KEY: "g-key", MEDIA_DIR: dir }, fetchImpl);
    assert.equal(headers["x-goog-api-key"], "g-key", "key sent as a header, not in the URL");
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "1:1", "character sheets are square");
    assert.match(r.url, /^\/media\/[0-9a-f-]{36}\.png$/);
    assert.equal(await readFile(join(dir, r.url.slice(7)), "utf8"), "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("image: reports when no image comes back", async () => {
  const empty = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }))) as unknown as typeof fetch;
  await assert.rejects(
    generateImage({ kind: "environment", name: "Isle", description: "", aspectRatio: "16:9" }, { GOOGLE_API_KEY: "g" }, empty),
    /returned no image/,
  );
});
