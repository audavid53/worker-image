import { test } from "node:test";
import assert from "node:assert/strict";
import { narrativeById } from "../shared/narratives";
import { extractScriptCharacters, generateStory, normalizeDraft, StoryError } from "./story";

const base = {
  projectName: "The Bridge",
  aspectRatio: "9:16",
  narrativeId: "fact-short",
  scenePresetId: "continuous-glide",
  runtimeSeconds: 62,
  idea: "Seventy-four soldiers knocked down an iron bridge just by walking across it.",
};

const okResponse = (draft: unknown) =>
  (async () =>
    new Response(
      JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }),
      { status: 200 },
    )) as unknown as typeof fetch;

test("rejects invalid requests", async () => {
  await assert.rejects(generateStory({ ...base, idea: "" }, {}), (e: unknown) => e instanceof StoryError && e.status === 400);
  await assert.rejects(generateStory({ ...base, narrativeId: "nope" }, {}), /Unknown story template/);
});

test("without an API key returns an offline draft with the template's beats", async () => {
  const r = await generateStory(base, {});
  assert.equal(r.source, "offline");
  assert.deepEqual(
    r.draft.beats.map((b) => b.key),
    narrativeById("fact-short")!.beats.map((b) => b.key),
  );
  assert.equal(r.draft.characters[0].name, "Protagonist");
});

test("a user's own structure travels with the request and drives the beats", async () => {
  const mine = {
    id: "my-heist-ab12",
    name: "Heist",
    blurb: "",
    runtime: { min_s: 30, max_s: 300, default_s: 90 },
    beats: [
      { key: "crew", act: "Setup", name: "Assemble the crew", purpose: "", share: 0.3 },
      { key: "job", act: "Job", name: "The job", purpose: "", share: 0.5 },
      { key: "twist", act: "Twist", name: "Double-cross", purpose: "", share: 0.2 },
    ],
    global_rules: [],
  };
  const r = await generateStory({ ...base, narrativeId: mine.id, narrative: mine, runtimeSeconds: 90 }, {});
  assert.deepEqual(
    r.draft.beats.map((b) => b.key),
    ["crew", "job", "twist"],
  );
  await assert.rejects(generateStory({ ...base, narrativeId: "my-unknown" }, {}), /Unknown story template/);
  await assert.rejects(
    generateStory({ ...base, narrativeId: mine.id, narrative: { ...mine, beats: [{ ...mine.beats[0], share: 0.1 }] } }, {}),
    (e: unknown) => e instanceof StoryError && e.status === 400,
    "an invalid structure (shares not 100%) is rejected",
  );
});

test("offline draft picks character names from a pasted screenplay", () => {
  const script = `INT. MINES - NIGHT\n\nGANDOLF\nRun!\n\nPRIVATE JONES (V.O.)\nWait.\n\nGANDOLF\nGo now.\n\nCUT TO:\n\nEXT. BRIDGE - NIGHT`;
  assert.deepEqual(extractScriptCharacters(script), ["Gandolf", "Private Jones"]);
});

test("with a key, sends a strict json_schema request and keeps the template's beat order", async () => {
  let sent: any;
  const model = { logline: "L", beats: [{ key: "snap", act: "x", name: "y", summary: "It breaks.", share: 0.5 }], characters: [], relationships: [] };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return (okResponse(model) as unknown as () => Promise<Response>)();
  }) as unknown as typeof fetch;

  const r = await generateStory(base, { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "test-model" }, fetchImpl);
  assert.equal(sent.model, "test-model");
  assert.equal(sent.text.format.type, "json_schema");
  assert.equal(sent.text.format.strict, true);
  assert.equal(r.source, "openai");
  const fact = narrativeById("fact-short")!;
  assert.equal(r.draft.beats.length, fact.beats.length);
  assert.equal(r.draft.beats.find((b) => b.key === "snap")!.summary, "It breaks.", "summary matched by key");
});

test("surfaces refusals and HTTP errors without leaking the key", async () => {
  const refusal = (async () =>
    new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }))) as unknown as typeof fetch;
  await assert.rejects(generateStory(base, { OPENAI_API_KEY: "sk-secret" }, refusal), /declined/);

  const fail = (async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(generateStory(base, { OPENAI_API_KEY: "sk-secret" }, fail), (e: unknown) => {
    assert.ok(e instanceof StoryError && e.status === 502 && !e.message.includes("sk-secret"));
    return true;
  });
});

test("custom structures get their shares normalised to sum to 1", () => {
  const d = normalizeDraft(
    {
      logline: "",
      characters: [],
      relationships: [],
      beats: [
        { key: "a", act: "1", name: "A", summary: "", share: 2 },
        { key: "b", act: "1", name: "B", summary: "", share: 2 },
      ],
    },
    undefined,
  );
  assert.deepEqual(
    d.beats.map((b) => b.share),
    [0.5, 0.5],
  );
});
