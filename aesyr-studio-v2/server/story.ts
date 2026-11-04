// /api/story: turns an idea or pasted script into a story outline and character bios.
// OpenAI (Responses API, strict JSON schema) when OPENAI_API_KEY is set; otherwise an
// offline draft built from the chosen template so the pipeline still works locally.
import { CUSTOM_NARRATIVE_ID, narrativeById, NARRATIVES, type NarrativeStructure } from "../shared/narratives";
import { StoryDraft, StoryRequest, type StoryResponse } from "../shared/story";
import { ApiError, openaiJson, type ProviderEnv } from "./openai";

export { ApiError as StoryError, DEFAULT_MODEL } from "./openai";
export type StoryEnv = ProviderEnv;

// Lengths are enforced by the zod StoryDraft check after the call, not in the strict schema.
const str = (_maxLength: number) => ({ type: "string" });

/** Strict structured-output schema: every property required, no extras. */
export const STORY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["logline", "beats", "characters", "relationships"],
  properties: {
    logline: str(400),
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "act", "name", "summary", "share"],
        properties: { key: str(60), act: str(60), name: str(80), summary: str(2000), share: { type: "number" } },
      },
    },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "description", "want", "need", "arc"],
        properties: {
          name: str(80),
          role: str(80),
          description: str(1500),
          want: str(500),
          need: str(500),
          arc: str(800),
        },
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label"],
        properties: { from: str(80), to: str(80), label: str(80) },
      },
    },
  },
} as const;

export function buildInstructions(req: StoryRequest, template: NarrativeStructure | undefined): string {
  const lines = [
    "You are a story editor helping a film director plan a short film or video.",
    "The user's input is either a rough idea or a pasted screenplay. Keep their story, names and tone; do not invent a different premise.",
    `Target runtime: ${req.runtimeSeconds} seconds. Aspect ratio ${req.aspectRatio}.`,
    "Write one logline. Write character bios only for characters who matter to the story (at most 8): role, a short visual description a 3D artist could model from, what they want, what they need, and their arc.",
    "Characters are people, creatures or anthropomorphic beings that act on screen. Places, buildings, vehicles and objects are NOT characters (they are cast later as environments and props), even when they matter to the plot.",
    "List relationships between those characters by exact name with a short label (e.g. 'mentor of', 'rivals'). Give each pair at most one relationship, in one direction only.",
    "Beat summaries are 1–3 sentences of concrete, filmable action.",
  ];
  if (template) {
    lines.push(
      `Use the "${template.name}" structure. Return exactly ${template.beats.length} beats, in this order, with these keys, acts and names:`,
      ...template.beats.map((b, i) => `${i + 1}. key=${b.key}; act=${b.act}; name=${b.name}; share=${b.share}; purpose: ${b.purpose}${b.rules ? ` Rules: ${b.rules.join(" ")}` : ""}`),
      ...template.global_rules.map((r) => `Rule: ${r}`),
    );
    if (template.pace) lines.push(`Narration pace is about ${template.pace.words_per_s} words per second.`);
  } else {
    lines.push(
      "Design the best beat structure for this story (4–15 beats), grouped into acts. Give each beat a short kebab-case key and a share of the runtime; shares must sum to 1.",
    );
  }
  return lines.join("\n");
}

/** Forces a template's beat keys/acts/names/shares onto the model output; normalises custom shares. */
export function normalizeDraft(draft: StoryDraft, template: NarrativeStructure | undefined): StoryDraft {
  if (template) {
    const beats = template.beats.map((b, i) => ({
      key: b.key,
      act: b.act,
      name: b.name,
      share: b.share,
      summary: (draft.beats.find((x) => x.key === b.key) ?? draft.beats[i])?.summary ?? "",
    }));
    return { ...draft, beats };
  }
  const total = draft.beats.reduce((s, b) => s + b.share, 0);
  const beats = draft.beats.map((b) => ({
    ...b,
    share: total > 0 ? b.share / total : 1 / draft.beats.length,
  }));
  return { ...draft, beats };
}

const SCENE_HEADING = /^(INT|EXT|INT\.?\/EXT|I\/E)[ .]/;
const TRANSITION = /(TO:|FADE (IN|OUT)|CUT TO|DISSOLVE)/;

/** Character cue names from a screenplay: upper-case lines followed by dialogue. */
export function extractScriptCharacters(text: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].replace(/\s*\((V\.O\.|O\.S\.|CONT'D|O\.C\.)\)\s*$/i, "");
    if (!/^[A-Z][A-Z0-9 .'-]{1,30}$/.test(line) || SCENE_HEADING.test(line) || TRANSITION.test(line)) continue;
    if (!lines[i + 1]) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([n]) => n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()));
}

export function offlineDraft(req: StoryRequest, template: NarrativeStructure | undefined): StoryDraft {
  const t = template ?? NARRATIVES[0];
  const names = extractScriptCharacters(req.idea);
  const firstSentence = req.idea.split(/(?<=[.!?])\s/)[0].slice(0, 300);
  return {
    logline: firstSentence,
    beats: t.beats.map((b) => ({ key: b.key, act: b.act, name: b.name, share: b.share, summary: "" })),
    characters: (names.length ? names : ["Protagonist"]).map((name, i) => ({
      name,
      role: i === 0 ? "Lead" : "",
      description: "",
      want: "",
      need: "",
      arc: "",
    })),
    relationships: [],
  };
}

export async function generateStory(body: unknown, env: StoryEnv, fetchImpl: typeof fetch = fetch): Promise<StoryResponse> {
  const parsed = StoryRequest.safeParse(body);
  if (!parsed.success) throw new ApiError(400, `Invalid request: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  const req = parsed.data;
  const template = req.narrativeId === CUSTOM_NARRATIVE_ID ? undefined : narrativeById(req.narrativeId);
  if (!template && req.narrativeId !== CUSTOM_NARRATIVE_ID) throw new ApiError(400, "Unknown story template");

  if (!env.OPENAI_API_KEY) {
    return { draft: offlineDraft(req, template), source: "offline" };
  }
  const { data: draft, model } = await openaiJson({
    env,
    fetchImpl,
    name: "story_draft",
    schema: STORY_JSON_SCHEMA,
    instructions: buildInstructions(req, template),
    input: `Project: ${req.projectName}\n\n${req.idea}`,
    validate: StoryDraft,
  });
  return { draft: normalizeDraft(draft, template), source: "openai", model };
}
