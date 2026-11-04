// Local project store. Shapes mirror the database tables (projects, story_beats, characters,
// character_relationships) so the Supabase repository can replace localStorage later.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { narrativeById } from "../../shared/narratives";
import type { NarrativeStructure, ScenePreset } from "../../shared/library";
import type { StoryDraft } from "../../shared/story";
import { NEXT_TYPE, type ElementType, type ScriptElement } from "../../shared/screenplay";
import { useStoredState } from "../useStoredState";
import { syncCast, type CastAsset, type Environment, type SceneMeta } from "./script-ops";
import type { Shot } from "../../shared/shots";
import { connect, disconnect, draftShots, moveShot } from "./shot-ops";
import type { TimelineDoc } from "../../shared/timeline";
import { newTimeline, seedTimeline, type Work } from "./timeline-ops";

export type { CastAsset, Environment, SceneMeta } from "./script-ops";

export interface ProjectMeta {
  name: string;
  aspectRatio: string;
  narrativeId: string;
  scenePresetId: string;
  runtimeSeconds: number;
  idea: string;
  logline: string;
  generatedBy?: "openai" | "offline";
  /** Snapshots of the library entries the project was made with (user entries may change later). */
  narrative?: NarrativeStructure;
  scenePreset?: ScenePreset;
}

export interface Beat {
  id: string;
  key: string;
  act: string;
  name: string;
  summary: string;
  color: number; // 1–9, beat palette
  targetSeconds: number;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  want: string;
  need: string;
  arc: string;
  x: number;
  y: number;
}

export interface Relationship {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface ProjectState {
  meta: ProjectMeta | null;
  beats: Beat[];
  characters: Character[];
  relationships: Relationship[];
  /** Flat screenplay; each heading starts a scene and its id is the scene id. */
  script: ScriptElement[];
  sceneMeta: Record<string, SceneMeta>;
  environments: Environment[];
  /** Card positions on the Casting canvas (separate from the Story canvas). */
  castLayout: Record<string, { x: number; y: number }>;
  assets: CastAsset[];
  /** The asset shown on each cast card. */
  activeAsset: Record<string, string>;
  /** Shot list in scene order; shared by the Shots table and the Director canvas. */
  shots: Shot[];
  /** Node positions on the Director canvas (scene and cast nodes). */
  directorLayout: Record<string, { x: number; y: number }>;
  /** Director timeline per scene (the shot track is derived from `shots`). */
  timelines: Record<string, TimelineDoc>;
}

const EMPTY: ProjectState = {
  meta: null,
  beats: [],
  characters: [],
  relationships: [],
  script: [],
  sceneMeta: {},
  environments: [],
  castLayout: {},
  assets: [],
  activeAsset: {},
  shots: [],
  directorLayout: {},
  timelines: {},
};

export const newId = () => crypto.randomUUID();

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Turns a generated draft into store records: beat colours follow acts, cards are laid out in a grid. */
export function draftToState(meta: ProjectMeta, draft: StoryDraft): ProjectState {
  const acts: string[] = [];
  const beats = draft.beats.map((b) => {
    if (!acts.includes(b.act)) acts.push(b.act);
    return {
      id: newId(),
      key: b.key,
      act: b.act,
      name: b.name,
      summary: b.summary,
      color: (acts.indexOf(b.act) % 8) + 2,
      targetSeconds: round1(b.share * meta.runtimeSeconds),
    };
  });
  // Staggered rows so relationship lines aren't collinear and their labels don't stack.
  const characters = draft.characters.map((c, i) => ({
    id: newId(),
    ...c,
    x: 40 + (i % 3) * 320,
    y: 70 + Math.floor(i / 3) * 520 + (i % 2) * 140,
  }));
  const byName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
  // One link per pair regardless of direction (matches the database's unique pair index); first wins.
  const seen = new Set<string>();
  const relationships = draft.relationships.flatMap((r) => {
    const from = byName.get(r.from.toLowerCase());
    const to = byName.get(r.to.toLowerCase());
    if (!from || !to || from === to) return [];
    const pair = [from, to].sort().join("|");
    if (seen.has(pair)) return [];
    seen.add(pair);
    return [{ id: newId(), from, to, label: r.label }];
  });
  return { ...EMPTY, meta: { ...meta, logline: draft.logline }, beats, characters, relationships };
}

function useProjectState() {
  const [stored, setState] = useStoredState<ProjectState>("project", EMPTY);
  // Projects saved by earlier versions lack the newer fields.
  const state = useMemo(() => ({ ...EMPTY, ...stored }), [stored]);

  const patch = useCallback(
    (fn: (s: ProjectState) => ProjectState) => setState((prev) => fn({ ...EMPTY, ...prev })),
    [setState],
  );

  return useMemo(
    () => ({
      state,
      replace: (next: ProjectState) => setState(next),
      reset: () => setState(EMPTY),
      updateMeta: (m: Partial<ProjectMeta>) => patch((s) => (s.meta ? { ...s, meta: { ...s.meta, ...m } } : s)),

      updateBeat: (id: string, b: Partial<Beat>) =>
        patch((s) => ({ ...s, beats: s.beats.map((x) => (x.id === id ? { ...x, ...b } : x)) })),
      addBeatAfter: (id: string | null) =>
        patch((s) => {
          const i = id ? s.beats.findIndex((b) => b.id === id) : s.beats.length - 1;
          const ref = s.beats[i];
          const beat: Beat = {
            id: newId(),
            key: "custom",
            act: ref?.act ?? "Act 1",
            name: "New beat",
            summary: "",
            color: ref?.color ?? 1,
            targetSeconds: 5,
          };
          const beats = [...s.beats];
          beats.splice(i + 1, 0, beat);
          return { ...s, beats };
        }),
      removeBeat: (id: string) => patch((s) => ({ ...s, beats: s.beats.filter((b) => b.id !== id) })),
      moveBeat: (id: string, dir: -1 | 1) =>
        patch((s) => {
          const i = s.beats.findIndex((b) => b.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.beats.length) return s;
          const beats = [...s.beats];
          [beats[i], beats[j]] = [beats[j], beats[i]];
          return { ...s, beats };
        }),

      addCharacter: (x: number, y: number) => {
        const c: Character = { id: newId(), name: "New character", role: "", description: "", want: "", need: "", arc: "", x, y };
        patch((s) => ({ ...s, characters: [...s.characters, c] }));
        return c.id;
      },
      updateCharacter: (id: string, c: Partial<Character>) =>
        patch((s) => ({ ...s, characters: s.characters.map((x) => (x.id === id ? { ...x, ...c } : x)) })),
      removeCharacter: (id: string) =>
        patch((s) => ({
          ...s,
          characters: s.characters.filter((c) => c.id !== id),
          relationships: s.relationships.filter((r) => r.from !== id && r.to !== id),
          shots: s.shots.map((x) => (x.castIds.includes(id) ? { ...x, castIds: x.castIds.filter((c) => c !== id) } : x)),
        })),

      addRelationship: (from: string, to: string, label = "") =>
        patch((s) =>
          from === to || s.relationships.some((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from))
            ? s
            : { ...s, relationships: [...s.relationships, { id: newId(), from, to, label }] },
        ),
      updateRelationship: (id: string, label: string) =>
        patch((s) => ({ ...s, relationships: s.relationships.map((r) => (r.id === id ? { ...r, label } : r)) })),
      removeRelationship: (id: string) =>
        patch((s) => ({ ...s, relationships: s.relationships.filter((r) => r.id !== id) })),

      // ----- script -----
      /** Replaces the script, then adds cast cards for new speakers and locations. */
      setScript: (script: ScriptElement[], sceneMeta: Record<string, SceneMeta> = {}) =>
        patch((s) => {
          const synced = syncCast(script, s.characters, s.environments, newId);
          return { ...s, script, sceneMeta: { ...s.sceneMeta, ...sceneMeta }, characters: synced.characters, environments: synced.environments };
        }),
      syncCastFromScript: () =>
        patch((s) => {
          const synced = syncCast(s.script, s.characters, s.environments, newId);
          return synced.added ? { ...s, characters: synced.characters, environments: synced.environments } : s;
        }),
      updateElement: (id: string, e: Partial<ScriptElement>) =>
        patch((s) => ({ ...s, script: s.script.map((x) => (x.id === id ? { ...x, ...e } : x)) })),
      /** Inserts after `id` (or at the end) and returns the new element's id. */
      insertElementAfter: (id: string | null, type?: ElementType, text = "") => {
        const nid = newId();
        patch((s) => {
          const i = id ? s.script.findIndex((x) => x.id === id) : s.script.length - 1;
          const t = type ?? (i >= 0 ? NEXT_TYPE[s.script[i].type] : "heading");
          const script = [...s.script];
          script.splice(i + 1, 0, { id: nid, type: t, text });
          return { ...s, script };
        });
        return nid;
      },
      removeElement: (id: string) =>
        patch((s) => {
          const { [id]: _gone, ...sceneMeta } = s.sceneMeta;
          // Removing a scene heading removes that scene's shots too.
          return { ...s, script: s.script.filter((x) => x.id !== id), sceneMeta, shots: s.shots.filter((x) => x.sceneId !== id) };
        }),
      setSceneMeta: (id: string, m: Partial<SceneMeta>) =>
        patch((s) => ({ ...s, sceneMeta: { ...s.sceneMeta, [id]: { ...(s.sceneMeta[id] ?? { color: 1 }), ...m } } })),

      // ----- casting -----
      addEnvironment: (name = "New location") => {
        const env: Environment = { id: newId(), name, description: "" };
        patch((s) => ({ ...s, environments: [...s.environments, env] }));
        return env.id;
      },
      updateEnvironment: (id: string, e: Partial<Environment>) =>
        patch((s) => ({ ...s, environments: s.environments.map((x) => (x.id === id ? { ...x, ...e } : x)) })),
      removeEnvironment: (id: string) =>
        patch((s) => ({
          ...s,
          environments: s.environments.filter((x) => x.id !== id),
          assets: s.assets.filter((a) => a.ownerId !== id),
          shots: s.shots.map((x) => (x.locationId === id ? { ...x, locationId: undefined } : x)),
        })),
      moveCast: (id: string, x: number, y: number) => patch((s) => ({ ...s, castLayout: { ...s.castLayout, [id]: { x, y } } })),
      addAsset: (a: Omit<CastAsset, "id" | "createdAt">) =>
        patch((s) => {
          const asset: CastAsset = { ...a, id: newId(), createdAt: new Date().toISOString() };
          return { ...s, assets: [...s.assets, asset], activeAsset: { ...s.activeAsset, [a.ownerId]: asset.id } };
        }),
      // ----- shots -----
      /** Adds first-pass shots for every scene that has none. Returns nothing; the count shows in the UI. */
      draftShotsFromScript: (wps: number) =>
        patch((s) => ({ ...s, shots: [...s.shots, ...draftShots(s.script, s.characters, s.environments, s.shots, wps, newId)] })),
      addShot: (sceneId: string, afterId?: string) => {
        const shot: Shot = {
          id: newId(),
          sceneId,
          title: "New shot",
          description: "",
          durationS: 3,
          size: "MS",
          view: "Front view",
          angle: "Eye level",
          movement: "Static",
          castIds: [],
          status: "draft",
          note: "",
        };
        patch((s) => {
          const at = afterId ? s.shots.findIndex((x) => x.id === afterId) + 1 : s.shots.map((x) => x.sceneId).lastIndexOf(sceneId) + 1;
          const shots = [...s.shots];
          shots.splice(at > 0 ? at : shots.length, 0, shot);
          return { ...s, shots };
        });
        return shot.id;
      },
      updateShot: (id: string, sh: Partial<Shot>) =>
        patch((s) => ({ ...s, shots: s.shots.map((x) => (x.id === id ? { ...x, ...sh } : x)) })),
      duplicateShot: (id: string) =>
        patch((s) => {
          const i = s.shots.findIndex((x) => x.id === id);
          if (i < 0) return s;
          const shots = [...s.shots];
          shots.splice(i + 1, 0, { ...s.shots[i], id: newId(), status: "draft" });
          return { ...s, shots };
        }),
      removeShot: (id: string) => patch((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== id) })),
      moveShot: (id: string, sceneId: string, beforeId: string | null) =>
        patch((s) => ({ ...s, shots: moveShot(s.shots, id, sceneId, beforeId) })),
      connectCast: (shotId: string, node: { kind: "character" | "environment"; id: string }) =>
        patch((s) => ({ ...s, shots: s.shots.map((x) => (x.id === shotId ? connect(x, node) : x)) })),
      disconnectCast: (shotId: string, node: { kind: "character" | "environment"; id: string }) =>
        patch((s) => ({ ...s, shots: s.shots.map((x) => (x.id === shotId ? disconnect(x, node) : x)) })),
      // ----- director timeline -----
      /** Creates (and seeds) the scene's timeline the first time it is opened. */
      ensureTimeline: (sceneId: string, wps: number) =>
        patch((s) => {
          if (s.timelines[sceneId]) return s;
          const sceneShots = s.shots.filter((x) => x.sceneId === sceneId);
          const doc = seedTimeline(newTimeline(sceneId, newId), s.script, sceneShots, wps, newId);
          return { ...s, timelines: { ...s.timelines, [sceneId]: doc } };
        }),
      /** Writes a timeline edit back: the doc, plus the scene's shots (order, durations, splits, deletes). */
      commitTimeline: (sceneId: string, w: Work) =>
        patch((s) => {
          const first = s.shots.findIndex((x) => x.sceneId === sceneId);
          const others = s.shots.filter((x) => x.sceneId !== sceneId);
          const at = first < 0 ? others.length : s.shots.slice(0, first).filter((x) => x.sceneId !== sceneId).length;
          return {
            ...s,
            timelines: { ...s.timelines, [sceneId]: w.doc },
            shots: [...others.slice(0, at), ...w.shots, ...others.slice(at)],
          };
        }),

      moveDirectorNode: (id: string, x: number, y: number) =>
        patch((s) => ({ ...s, directorLayout: { ...s.directorLayout, [id]: { x, y } } })),

      setActiveAsset: (ownerId: string, assetId: string) =>
        patch((s) => ({ ...s, activeAsset: { ...s.activeAsset, [ownerId]: assetId } })),
      removeAsset: (id: string) =>
        patch((s) => {
          const gone = s.assets.find((a) => a.id === id);
          const assets = s.assets.filter((a) => a.id !== id);
          const activeAsset = { ...s.activeAsset };
          if (gone && activeAsset[gone.ownerId] === id) {
            const next = assets.filter((a) => a.ownerId === gone.ownerId).at(-1);
            if (next) activeAsset[gone.ownerId] = next.id;
            else delete activeAsset[gone.ownerId];
          }
          return { ...s, assets, activeAsset };
        }),
    }),
    [state, setState, patch],
  );
}

type ProjectApi = ReturnType<typeof useProjectState>;
const Ctx = createContext<ProjectApi | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useProjectState()}>{children}</Ctx.Provider>;
}

export function useProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject outside ProjectProvider");
  return v;
}

/** The project's narrative structure: its snapshot, else the built-in with that id. */
export const projectNarrative = (meta: ProjectMeta | null) => meta?.narrative ?? (meta ? narrativeById(meta.narrativeId) : undefined);

export const narrativeName = (meta: ProjectMeta) => projectNarrative(meta)?.name ?? "Custom structure";

/** Speaking pace (words per second) used for durations; 2.5 when the structure sets none. */
export const projectPace = (meta: ProjectMeta | null) => projectNarrative(meta)?.pace?.words_per_s ?? 2.5;
