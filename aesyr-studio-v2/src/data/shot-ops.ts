// Pure shot-list operations (unit-tested; no React).
import { splitScenes, cueName, type ScriptElement } from "../../shared/screenplay";
import type { Shot } from "../../shared/shots";
import type { Character } from "./project";
import { castLinks, matchKey, type Environment } from "./script-ops";

const words = (t: string) => t.match(/\S+/g)?.length ?? 0;
const MOVING = /\b(runs?|running|walks?|walking|climbs?|climbing|rushes|races?|chases?|follows?|crosses|marches|drives?|sails?|hurries|steps? (?:out|in|into|onto))\b/i;
const round = (n: number) => Math.round(n * 10) / 10;

/** Speech runs at the template pace; action reads at ~2.5 words/s; every shot lasts at least 2 s. */
const speechSeconds = (w: number, wps: number) => Math.max(2, round(w / wps));
const actionSeconds = (w: number) => Math.max(2, round(w / 2.5));

function namedIn(text: string, characters: Character[]): string[] {
  const t = text.toLowerCase();
  return characters
    .filter((c) => {
      const k = matchKey(c.name);
      return k && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t);
    })
    .map((c) => c.id);
}

/**
 * Deterministic first-pass shot list for scenes that have no shots yet (the AI auto-director
 * replaces this in milestone 7): an establishing wide, a medium close-up per speech (alternating
 * to over-the-shoulder between different speakers), and a medium shot per further action beat.
 */
export function draftShots(
  script: ScriptElement[],
  characters: Character[],
  environments: Environment[],
  existing: Shot[],
  wps: number,
  newId: () => string,
): Shot[] {
  const links = castLinks(script, characters, environments);
  const charByKey = new Map(characters.map((c) => [matchKey(c.name), c.id]));
  const out: Shot[] = [];
  const base = (sceneId: string, locationId?: string) => ({
    id: newId(),
    sceneId,
    locationId,
    status: "draft" as const,
    note: "",
  });

  for (const scene of splitScenes(script)) {
    if (existing.some((s) => s.sceneId === scene.id)) continue;
    const cast = links.sceneCast[scene.id] ?? { characterIds: [] };
    const loc = environments.find((e) => e.id === cast.environmentId)?.name ?? "the scene";
    const actions = scene.elements.filter((e) => e.type === "action");
    const first = actions[0];

    out.push({
      ...base(scene.id, cast.environmentId),
      title: `Establishing ${loc}`,
      description: first?.text ?? "",
      durationS: first ? actionSeconds(words(first.text)) : 3,
      size: "WS",
      view: "Front view",
      angle: "Eye level",
      movement: "Static",
      castIds: first ? namedIn(first.text, characters) : [],
    });

    let lastSpeaker: string | null = null;
    for (let i = 0; i < scene.elements.length; i++) {
      const e = scene.elements[i];
      if (e.type === "character") {
        const speaker = cueName(e.text);
        const id = charByKey.get(matchKey(speaker));
        let w = 0;
        let line = "";
        for (let j = i + 1; j < scene.elements.length && (scene.elements[j].type === "dialogue" || scene.elements[j].type === "parenthetical"); j++) {
          if (scene.elements[j].type === "dialogue") {
            w += words(scene.elements[j].text);
            line = line ? `${line} ${scene.elements[j].text}` : scene.elements[j].text;
          }
        }
        const reverse = lastSpeaker !== null && lastSpeaker !== speaker;
        const voiceOver = /\((V\.O\.|O\.S\.)\)/i.test(e.text);
        out.push({
          ...base(scene.id, cast.environmentId),
          title: voiceOver ? `${speaker} (voice)` : speaker,
          description: line,
          durationS: speechSeconds(w, wps),
          size: voiceOver ? "WS" : "MCU",
          view: reverse ? "Over-the-shoulder" : "Three-quarter",
          angle: "Eye level",
          movement: voiceOver ? "Push in" : "Static",
          castIds: id && !voiceOver ? [id] : [],
        });
        lastSpeaker = speaker;
      } else if (e.type === "action" && e !== first) {
        const named = namedIn(e.text, characters);
        out.push({
          ...base(scene.id, cast.environmentId),
          title: e.text.split(/[.!?]/)[0].slice(0, 60),
          description: e.text,
          durationS: actionSeconds(words(e.text)),
          size: "MS",
          view: "Three-quarter",
          angle: "Eye level",
          movement: MOVING.test(e.text) ? "Tracking shot" : "Static",
          castIds: named,
        });
      }
    }
  }
  return out;
}

export interface ShotTiming {
  start: number; // seconds from the film start
  number: string; // "2.3" = scene 2, shot 3
}

/** Start times follow scene order, then shot order within the scene. */
export function shotTimings(script: ScriptElement[], shots: Shot[]): Record<string, ShotTiming> {
  const out: Record<string, ShotTiming> = {};
  let t = 0;
  for (const scene of splitScenes(script)) {
    let n = 0;
    for (const s of shots) {
      if (s.sceneId !== scene.id) continue;
      n++;
      out[s.id] = { start: round(t), number: `${scene.index + 1}.${n}` };
      t += s.durationS;
    }
  }
  return out;
}

/** Moves a shot to a scene, before `beforeId` (or to the end of that scene). */
export function moveShot(shots: Shot[], id: string, sceneId: string, beforeId: string | null): Shot[] {
  const moving = shots.find((s) => s.id === id);
  if (!moving || id === beforeId) return shots;
  const rest = shots.filter((s) => s.id !== id);
  const updated = { ...moving, sceneId };
  let at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  if (at < 0) {
    const lastInScene = rest.map((s) => s.sceneId).lastIndexOf(sceneId);
    at = lastInScene >= 0 ? lastInScene + 1 : rest.length;
  }
  return [...rest.slice(0, at), updated, ...rest.slice(at)];
}

/** Wires a cast node into a shot: characters join the shot's cast, a location becomes its location. */
export function connect(shot: Shot, node: { kind: "character" | "environment"; id: string }): Shot {
  if (node.kind === "environment") return { ...shot, locationId: node.id };
  return shot.castIds.includes(node.id) ? shot : { ...shot, castIds: [...shot.castIds, node.id] };
}

export function disconnect(shot: Shot, node: { kind: "character" | "environment"; id: string }): Shot {
  if (node.kind === "environment") return shot.locationId === node.id ? { ...shot, locationId: undefined } : shot;
  return { ...shot, castIds: shot.castIds.filter((c) => c !== node.id) };
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
