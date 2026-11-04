export type StageId = "idea" | "story" | "script" | "shots" | "motion";
export type ViewMode = "a" | "split" | "b";

export interface PanelDef {
  title: string;
  hint: string;
}

export interface StageDef {
  id: StageId;
  label: string;
  /** Idea is a single welcome card; every other stage has a structured panel (A) and a canvas (B). */
  single?: boolean;
  a: PanelDef;
  b?: PanelDef;
}

export const STAGES: StageDef[] = [
  {
    id: "idea",
    label: "Idea",
    single: true,
    a: { title: "New project", hint: "Name, aspect ratio, story template and your idea or script." },
  },
  {
    id: "story",
    label: "Story",
    a: { title: "Story outline", hint: "Acts, beats and scenes from the chosen narrative structure." },
    b: { title: "Character bios", hint: "Character cards, arcs and relationships." },
  },
  {
    id: "script",
    label: "Script & Cast",
    a: { title: "Script", hint: "Screenplay broken into scene sections, action and dialogue." },
    b: { title: "Casting", hint: "Character and environment blocks with 2D, code-3D and Tripo 3D slots." },
  },
  {
    id: "shots",
    label: "Shots",
    a: { title: "Shot list", hint: "One row per shot: casting, location, size, view, angle, movement." },
    b: { title: "Director", hint: "Scene timelines with connectors from cast and environments." },
  },
  {
    id: "motion",
    label: "Motion",
    a: { title: "Motion & camera", hint: "Per-shot character motion and camera keys." },
    b: { title: "Animatic", hint: "Three.js playback of every shot in timeline order." },
  },
];

export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id);

/** A stage is open when every earlier stage has been approved. */
export const isUnlocked = (id: StageId, approved: Partial<Record<StageId, boolean>>) =>
  STAGES.slice(0, stageIndex(id)).every((s) => approved[s.id]);
