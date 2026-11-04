// Contracts for script generation and casting (2D image, code-3D, Tripo 3D).
import { z } from "zod";
import { ASPECT_RATIOS } from "./story";
import { ELEMENT_TYPES } from "./screenplay";
import { NarrativeStructure } from "./library";

// ---------- script ----------

export const ScriptRequest = z.object({
  projectName: z.string().trim().min(1).max(120),
  narrativeId: z.string().min(1).max(60),
  runtimeSeconds: z.number().int().min(10).max(7200),
  logline: z.string().max(400),
  beats: z
    .array(z.object({ key: z.string().max(60), name: z.string().max(80), summary: z.string().max(2000), targetSeconds: z.number().min(0).max(7200) }))
    .min(1)
    .max(40),
  characters: z.array(z.object({ name: z.string().min(1).max(80), description: z.string().max(1500) })).max(24),
  /** The project's structure snapshot (custom structures aren't known to the server by id). */
  narrative: NarrativeStructure.optional(),
});
export type ScriptRequest = z.infer<typeof ScriptRequest>;

export const ScriptDraft = z.object({
  scenes: z
    .array(
      z.object({
        heading: z.string().max(120),
        beat_key: z.string().max(60),
        elements: z.array(z.object({ type: z.enum(ELEMENT_TYPES), text: z.string().max(4000) })).max(200),
      }),
    )
    .min(1)
    .max(80),
});
export type ScriptDraft = z.infer<typeof ScriptDraft>;

// ---------- 2D image ----------

export const ImageRequest = z.object({
  kind: z.enum(["character", "environment"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS),
  styleNote: z.string().max(300).optional(),
});
export type ImageRequest = z.infer<typeof ImageRequest>;

// ---------- code-3D (primitive rig rendered by three.js; data only, never executable code) ----------

export const SHAPES = ["box", "sphere", "capsule", "cylinder", "cone", "torus"] as const;
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
/** Lenient on input (models sometimes return 2 or 4 numbers), always a clamped 3-vector out. */
const vec = (min: number, max: number) =>
  z
    .array(z.number())
    .min(1)
    .max(4)
    .transform((a) => [0, 1, 2].map((i) => clamp(a[i] ?? a[0], min, max)) as [number, number, number]);

export const Code3DPart = z.object({
  name: z.string().max(40),
  shape: z.enum(SHAPES),
  size: vec(0.01, 50), // metres; meaning per shape documented in the generator prompt
  position: vec(-50, 50),
  rotation: vec(-360, 360), // degrees
  color: z.string().transform((c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#8a8f98")),
});

export const Code3DSpec = z.object({
  height_m: z.number().min(0.05).max(100),
  parts: z.array(Code3DPart).min(1).max(48),
});
export type Code3DSpec = z.infer<typeof Code3DSpec>;

export const Code3DRequest = z.object({
  kind: z.enum(["character", "environment"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000),
});
export type Code3DRequest = z.infer<typeof Code3DRequest>;

// ---------- costs (estimates shown on buttons; charged once the job runner lands, milestone 8) ----------

export const CREDIT_COST = { image_google: 4, llm_code3d: 1, tripo_model: 30, llm_script: 2 } as const;
