// Pure script/casting operations on the project state (unit-tested; no React).
import type { ScriptDraft } from "../../shared/casting";
import type { Code3DSpec } from "../../shared/casting";
import { breakdown, splitScenes, type ScriptElement } from "../../shared/screenplay";
import type { Beat, Character } from "./project";

export interface Environment {
  id: string;
  name: string;
  description: string;
}

export interface SceneMeta {
  beatId?: string;
  color: number;
}

export interface CastAsset {
  id: string;
  ownerId: string; // character or environment id
  kind: "image" | "code3d";
  url?: string;
  spec?: Code3DSpec;
  prompt: string;
  model?: string;
  createdAt: string;
}

/** Names match across script cues and cast cards ignoring case and "(voice)"-style notes. */
export const matchKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function scriptFromDraft(
  draft: ScriptDraft,
  beats: Beat[],
  newId: () => string,
): { script: ScriptElement[]; sceneMeta: Record<string, SceneMeta> } {
  const script: ScriptElement[] = [];
  const sceneMeta: Record<string, SceneMeta> = {};
  for (const scene of draft.scenes) {
    const id = newId();
    script.push({ id, type: "heading", text: scene.heading.toUpperCase() });
    const beat = beats.find((b) => b.key === scene.beat_key);
    sceneMeta[id] = { beatId: beat?.id, color: beat?.color ?? 1 };
    for (const e of scene.elements) if (e.type !== "heading") script.push({ id: newId(), type: e.type, text: e.text });
  }
  return { script, sceneMeta };
}

export interface CastLinks {
  /** scene id -> character ids / environment id */
  sceneCast: Record<string, { characterIds: string[]; environmentId?: string }>;
  /** cast id -> scene numbers (1-based) */
  appearances: Record<string, number[]>;
  /** speakers in the script with no matching character card */
  unmatchedCharacters: string[];
  unmatchedLocations: string[];
}

export function castLinks(script: ScriptElement[], characters: Character[], environments: Environment[]): CastLinks {
  const charByKey = new Map(characters.map((c) => [matchKey(c.name), c.id]));
  const envByKey = new Map(environments.map((e) => [matchKey(e.name), e.id]));
  const sceneCast: CastLinks["sceneCast"] = {};
  const appearances: Record<string, number[]> = {};
  const unmatchedCharacters = new Set<string>();
  const unmatchedLocations = new Set<string>();
  const note = (id: string, n: number) => {
    const list = (appearances[id] ??= []);
    if (!list.includes(n)) list.push(n);
  };

  for (const scene of splitScenes(script)) {
    const b = breakdown(scene);
    const characterIds: string[] = [];
    for (const name of b.characters) {
      const id = charByKey.get(matchKey(name));
      if (id) {
        characterIds.push(id);
        note(id, scene.index + 1);
      } else unmatchedCharacters.add(name);
    }
    // Characters named in the action lines also appear in the scene (e.g. silent roles).
    const action = scene.elements
      .filter((e) => e.type === "action")
      .map((e) => e.text.toLowerCase())
      .join(" ");
    for (const c of characters) {
      const key = matchKey(c.name);
      if (key && !characterIds.includes(c.id) && new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(action)) {
        characterIds.push(c.id);
        note(c.id, scene.index + 1);
      }
    }
    const environmentId = b.location ? envByKey.get(matchKey(b.location)) : undefined;
    if (environmentId) note(environmentId, scene.index + 1);
    else if (b.location) unmatchedLocations.add(b.location);
    sceneCast[scene.id] = { characterIds, environmentId };
  }
  return { sceneCast, appearances, unmatchedCharacters: [...unmatchedCharacters], unmatchedLocations: [...unmatchedLocations] };
}

/** Creates character and environment cards for every speaker/location the script mentions but the cast lacks. */
export function syncCast(
  script: ScriptElement[],
  characters: Character[],
  environments: Environment[],
  newId: () => string,
): { characters: Character[]; environments: Environment[]; added: number } {
  const links = castLinks(script, characters, environments);
  const newChars: Character[] = links.unmatchedCharacters.map((name, i) => ({
    id: newId(),
    name,
    role: "",
    description: "",
    want: "",
    need: "",
    arc: "",
    x: 40 + ((characters.length + i) % 3) * 320,
    y: 70 + Math.floor((characters.length + i) / 3) * 520,
  }));
  const newEnvs: Environment[] = links.unmatchedLocations.map((name) => ({ id: newId(), name, description: "" }));
  return {
    characters: [...characters, ...newChars],
    environments: [...environments, ...newEnvs],
    added: newChars.length + newEnvs.length,
  };
}
