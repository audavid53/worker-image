// Screenplay model shared by the editor, the script API and the breakdown.
// A script is a flat list of elements; every `heading` starts a scene, and the heading's
// id is the scene's id (so scene metadata survives edits to the text).

export const ELEMENT_TYPES = ["heading", "action", "character", "parenthetical", "dialogue", "transition"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export interface ScriptElement {
  id: string;
  type: ElementType;
  text: string;
}

export interface SceneSpan {
  id: string; // heading element id
  index: number; // 0-based scene number
  heading: ScriptElement;
  elements: ScriptElement[]; // body, excluding the heading
}

const HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[ .]/i;
const TRANSITION = /^(?:[A-Z0-9 ]+ TO:|FADE (?:IN|OUT)[.:]?|CUT TO BLACK\.?)$/;
const CUE_EXTENSION = /\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D)\)\s*$/i;

const isUpper = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

/** Next element type when pressing Enter at the end of an element (screenwriting convention). */
export const NEXT_TYPE: Record<ElementType, ElementType> = {
  heading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "action",
  transition: "heading",
};

/** Tab cycles through these. */
export const TAB_CYCLE: ElementType[] = ["action", "character", "dialogue", "parenthetical", "transition", "heading"];

/** Heuristic: is this pasted text a screenplay (rather than a prose idea)? */
export function looksLikeScreenplay(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const headings = lines.filter((l) => HEADING.test(l) || /^\.[A-Z]/.test(l)).length;
  let cues = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] && isUpper(lines[i]) && lines[i].length < 40 && !HEADING.test(lines[i]) && lines[i + 1] && !isUpper(lines[i + 1])) cues++;
  }
  return headings >= 1 && cues >= 1;
}

/**
 * Parses Fountain-style plain text into elements. Blank lines separate blocks; an upper-case
 * line followed directly by text is a character cue. Text before the first scene heading
 * goes into an untitled first scene.
 */
export function parseScreenplay(text: string, newId: () => string): ScriptElement[] {
  const out: ScriptElement[] = [];
  const push = (type: ElementType, t: string) => out.push({ id: newId(), type, text: t });
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length);

  for (const lines of blocks) {
    const first = lines[0];
    if (lines.length === 1 && (HEADING.test(first) || /^\.[A-Za-z]/.test(first))) {
      push("heading", (first.startsWith(".") ? first.slice(1) : first).toUpperCase());
    } else if (lines.length === 1 && TRANSITION.test(first)) {
      push("transition", first);
    } else if (lines.length > 1 && isUpper(first) && first.length <= 40 && !HEADING.test(first)) {
      push("character", first);
      for (const l of lines.slice(1)) push(/^\(.*\)$/.test(l) ? "parenthetical" : "dialogue", l);
    } else if (HEADING.test(first)) {
      push("heading", first.toUpperCase());
      if (lines.length > 1) push("action", lines.slice(1).join("\n"));
    } else {
      push("action", lines.join("\n"));
    }
  }
  // merge consecutive dialogue lines of the same speech
  const merged: ScriptElement[] = [];
  for (const e of out) {
    const prev = merged[merged.length - 1];
    if (prev && e.type === "dialogue" && prev.type === "dialogue") prev.text += " " + e.text;
    else merged.push(e);
  }
  if (merged.length && merged[0].type !== "heading") merged.unshift({ id: newId(), type: "heading", text: "" });
  return merged;
}

export function splitScenes(script: ScriptElement[]): SceneSpan[] {
  const scenes: SceneSpan[] = [];
  for (const e of script) {
    if (e.type === "heading") scenes.push({ id: e.id, index: scenes.length, heading: e, elements: [] });
    else scenes[scenes.length - 1]?.elements.push(e);
  }
  return scenes;
}

/** "PRIVATE JONES (V.O.)" -> "Private Jones" */
export function cueName(cue: string): string {
  return cue
    .replace(CUE_EXTENSION, "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface HeadingParts {
  place: "INT" | "EXT" | "INT/EXT" | "";
  location: string;
  time: string;
}

/** "INT. MINES OF MORIA - NIGHT" -> { place: "INT", location: "Mines Of Moria", time: "Night" } */
export function parseHeading(heading: string): HeadingParts {
  const m = heading.trim().match(/^(INT\.?\/EXT|I\/E|INT|EXT|EST)\.?\s+(.*)$/i);
  if (!m) return { place: "", location: heading.trim() ? cueName(heading) : "", time: "" };
  const prefix = m[1].toUpperCase();
  const place = prefix.startsWith("INT") && prefix.includes("EXT") ? "INT/EXT" : prefix === "I/E" ? "INT/EXT" : prefix === "EXT" || prefix === "EST" ? "EXT" : "INT";
  const [loc, ...rest] = m[2].split(/\s+[-–—]\s+/);
  return { place, location: cueName(loc), time: rest.length ? cueName(rest.join(" - ")) : "" };
}

export interface SceneBreakdown {
  characters: string[]; // display names, in order of first appearance
  location: string;
  time: string;
  words: number;
}

export function breakdown(scene: SceneSpan): SceneBreakdown {
  const characters: string[] = [];
  for (const e of scene.elements) {
    if (e.type !== "character") continue;
    const n = cueName(e.text);
    if (n && !characters.includes(n)) characters.push(n);
  }
  const words = scene.elements.reduce((s, e) => s + (e.text.match(/\S+/g)?.length ?? 0), 0);
  const h = parseHeading(scene.heading.text);
  return { characters, location: h.location, time: h.time, words };
}

/** Plain-text export (Fountain-compatible). */
export function toFountain(script: ScriptElement[]): string {
  return script
    .map((e) => (e.type === "dialogue" || e.type === "parenthetical" ? e.text : `\n${e.text}`))
    .join("\n")
    .trim();
}
