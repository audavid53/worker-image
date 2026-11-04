// /api/script, /api/image and /api/code3d handlers.
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Code3DRequest, Code3DSpec, ImageRequest, ScriptDraft, ScriptRequest, SHAPES } from "../shared/casting";
import { ELEMENT_TYPES } from "../shared/screenplay";
import { narrativeById } from "../shared/narratives";
import { ApiError, openaiJson, s, type ProviderEnv } from "./openai";

const invalid = (issues: { path: PropertyKey[] }[]) =>
  new ApiError(400, `Invalid request: ${issues.map((i) => i.path.join(".")).join(", ")}`);

const requireOpenAI = (env: ProviderEnv) => {
  if (!env.OPENAI_API_KEY) throw new ApiError(400, "OPENAI_API_KEY is not set on the server (.env.local).");
};

// ---------- script ----------

export const SCRIPT_SCHEMA = s.obj({
  scenes: s.arr(
    s.obj({
      heading: s.str(),
      beat_key: s.str(),
      elements: s.arr(s.obj({ type: s.enum(ELEMENT_TYPES.filter((t) => t !== "heading")), text: s.str() })),
    }),
  ),
});

export function scriptInstructions(req: ScriptRequest): string {
  const t = narrativeById(req.narrativeId);
  return [
    "You are a screenwriter. Write the screenplay for the outline below in standard screenplay form.",
    "Return scenes in order. Each scene has a heading like 'INT. LIGHTHOUSE LAMP ROOM - NIGHT' or 'EXT. BRIDGE - DAY', the key of the beat it serves, and its elements.",
    "Element types: action (present tense, visual, short paragraphs), character (the speaker's name in CAPS, optionally with (V.O.) or (O.S.)), parenthetical (e.g. '(quietly)'), dialogue (the line spoken), transition (e.g. 'CUT TO:'). A character element is always followed by dialogue (optionally a parenthetical first).",
    "Use the cast's exact names for speakers. Reuse the same location name across scenes when it is the same place.",
    `The film runs about ${req.runtimeSeconds} seconds; spend screen time roughly as each beat's seconds say. Keep it lean: every line must be filmable.`,
    t?.pace ? `Narration is about ${t.pace.words_per_s} words per second; use a NARRATOR (V.O.) where the structure calls for narration.` : "",
    ...(t?.global_rules ?? []).map((r) => `Rule: ${r}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateScript(body: unknown, env: ProviderEnv, fetchImpl: typeof fetch = fetch) {
  const parsed = ScriptRequest.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error.issues);
  requireOpenAI(env);
  const req = parsed.data;
  const input = [
    `Title: ${req.projectName}`,
    `Logline: ${req.logline}`,
    "Cast:",
    ...req.characters.map((c) => `- ${c.name}: ${c.description}`),
    "Outline:",
    ...req.beats.map((b) => `- [${b.key}] ${b.name} (${b.targetSeconds}s): ${b.summary}`),
  ].join("\n");
  const { data, model } = await openaiJson({
    env,
    fetchImpl,
    name: "screenplay",
    schema: SCRIPT_SCHEMA,
    instructions: scriptInstructions(req),
    input,
    validate: ScriptDraft,
    timeoutMs: 240_000,
  });
  return { draft: data, model };
}

// ---------- code-3D ----------

const v3 = s.arr(s.num());
export const CODE3D_SCHEMA = s.obj({
  height_m: s.num(),
  parts: s.arr(
    s.obj({ name: s.str(), shape: s.enum(SHAPES), size: v3, position: v3, rotation: v3, color: s.str() }),
  ),
});

export function code3dInstructions(kind: "character" | "environment"): string {
  return [
    "You build simple, low-poly 3D blockouts from primitives for a film previsualisation tool. Output data only.",
    "Units are metres. Y is up; the model stands on y = 0 and faces +Z. Positions are part centres.",
    "Shapes and size meaning: box [width, height, depth]; sphere [diameter, diameter, diameter]; capsule [diameter, total height, diameter]; cylinder [diameter, height, diameter]; cone [base diameter, height, base diameter]; torus [outer diameter, tube thickness, unused].",
    "rotation is [x, y, z] in degrees. color is #RRGGBB. Use 6–40 parts with readable proportions and a limited, intentional palette.",
    "Clothing wraps the body closely: a coat is only slightly larger than the torso it covers and must not hide the arms or swallow the figure.",
    kind === "character"
      ? "For a character: a clear silhouette (head, torso, arms, legs, signature costume/props), about real human scale unless described otherwise, symmetric where natural, arms slightly away from the body."
      : "For an environment: a compact set piece around the origin (floor, key structures, a few props) no larger than 20 m across.",
    "Set height_m to the model's total height.",
  ].join("\n");
}

export async function generateCode3D(body: unknown, env: ProviderEnv, fetchImpl: typeof fetch = fetch) {
  const parsed = Code3DRequest.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error.issues);
  requireOpenAI(env);
  const req = parsed.data;
  const { data, model } = await openaiJson({
    env,
    fetchImpl,
    name: "primitive_model",
    schema: CODE3D_SCHEMA,
    instructions: code3dInstructions(req.kind),
    input: `${req.kind === "character" ? "Character" : "Environment"}: ${req.name}\n${req.description}`,
    validate: Code3DSpec,
  });
  return { spec: data, model };
}

// ---------- 2D image (Google Gemini image model) ----------

export const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function imagePrompt(req: ImageRequest): string {
  const style = req.styleNote ? ` Style: ${req.styleNote}.` : " Style: clean stylised concept art, soft studio lighting, readable shapes.";
  return req.kind === "character"
    ? `Character reference sheet for "${req.name}": full body front view and three-quarter view side by side on a plain neutral background, consistent design, no text or labels. ${req.description}.${style}`
    : `Environment concept plate for "${req.name}": a wide establishing view with clear depth, no people, no text. ${req.description}.${style}`;
}

export async function generateImage(body: unknown, env: ProviderEnv, fetchImpl: typeof fetch = fetch) {
  const parsed = ImageRequest.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error.issues);
  if (!env.GOOGLE_API_KEY) throw new ApiError(400, "GOOGLE_API_KEY is not set on the server (.env.local).");
  const req = parsed.data;
  const model = env.GOOGLE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_API_KEY },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: imagePrompt(req) }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: req.kind === "character" ? "1:1" : req.aspectRatio === "2.39:1" ? "21:9" : req.aspectRatio },
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  if (!res.ok) throw new ApiError(502, `Google image request failed (${res.status}): ${json.error?.message ?? "unknown error"}`);
  const img = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("image/"))?.inlineData;
  if (!img?.data || !img.mimeType || !IMAGE_TYPES[img.mimeType]) throw new ApiError(502, "The image model returned no image.");
  if (img.data.length > 28_000_000) throw new ApiError(502, "The image is too large.");

  const dir = env.MEDIA_DIR ?? ".local-media";
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${IMAGE_TYPES[img.mimeType]}`;
  await writeFile(join(dir, file), Buffer.from(img.data, "base64"));
  return { url: `/media/${file}`, model, prompt: imagePrompt(req) };
}
