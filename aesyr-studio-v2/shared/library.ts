// The two libraries (plan §6): narrative structures and scene presets. Validated with zod
// everywhere they cross a boundary (server requests, the library editor, the database seed).
import { z } from "zod";
import { CAMERA_MOVES, SHOT_SIZES } from "./shots";

const sizeValues = SHOT_SIZES.map((s) => s.value) as [string, ...string[]];
const range = (min: number, max: number) =>
  z.tuple([z.number().min(min).max(max), z.number().min(min).max(max)]).refine(([a, b]) => a <= b, "min must not exceed max");

// ---------------------------------------------------------------------------
// Narrative Library (§6.1): how a story is structured
// ---------------------------------------------------------------------------

export const NarrativeBeat = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/, "lower-case letters, digits and dashes"),
  act: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  purpose: z.string().max(400),
  /** Fraction of runtime; a structure's shares sum to 1. */
  share: z.number().min(0).max(1),
  rules: z.array(z.string().max(200)).max(10).optional(),
  /** Hints for the auto-director (milestone 7). */
  default_shot_bias: z
    .object({ sizes: z.array(z.enum(sizeValues)).max(8), moves: z.array(z.enum(CAMERA_MOVES)).max(8) })
    .optional(),
});
export type NarrativeBeat = z.infer<typeof NarrativeBeat>;

export const NarrativeStructure = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    name: z.string().min(1).max(80),
    blurb: z.string().max(200),
    version: z.number().int().min(1).default(1),
    source: z.enum(["builtin", "analysed", "custom"]).default("builtin"),
    runtime: z
      .object({ min_s: z.number().min(5).max(7200), max_s: z.number().min(5).max(7200), default_s: z.number().min(5).max(7200) })
      .refine((r) => r.min_s <= r.default_s && r.default_s <= r.max_s, "default runtime must sit between min and max"),
    pace: z.object({ words_per_s: z.number().min(0.5).max(6) }).optional(),
    beats: z.array(NarrativeBeat).min(1).max(40),
    global_rules: z.array(z.string().max(300)).max(20),
    evidence: z.object({ reference_ids: z.array(z.string()).optional(), report_md: z.string().optional() }).optional(),
  })
  .refine((n) => Math.abs(n.beats.reduce((s, b) => s + b.share, 0) - 1) < 0.011, { message: "beat shares must add up to 100%", path: ["beats"] })
  .refine((n) => new Set(n.beats.map((b) => b.key)).size === n.beats.length, { message: "beat keys must be unique", path: ["beats"] });
export type NarrativeStructure = z.infer<typeof NarrativeStructure>;

// ---------------------------------------------------------------------------
// Scene Preset Library (§6.2): how a scene is shot. Every value is a number the
// camera solver applies and the QA pass checks.
// ---------------------------------------------------------------------------

export const FramingRow = z.object({
  /** How many frame heights the subject's full body spans (CU ≈ 5: only the head and shoulders fit). */
  body_frames: z.number().min(0.05).max(40),
  fov_deg: z.number().min(10).max(100),
  /** Background blur at 1080 px width; 0 = everything sharp. */
  lens_blur_px_1080: z.number().min(0).max(40),
});

export const ScenePreset = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(80),
  blurb: z.string().max(200),
  version: z.number().int().min(1).default(1),
  source: z.enum(["builtin", "analysed", "custom"]).default("builtin"),
  family: z.string().min(1).max(40),
  /** "draft" until its numbers are measured from references (reference analyser, milestone 9). */
  status: z.enum(["ready", "draft"]),
  camera: z.object({
    hold_pct: z.number().min(0).max(100),
    drift_pct: z.number().min(0).max(100),
    move_pct: z.number().min(0).max(100),
    glide_frames: range(1, 240),
    /** expoOut: snap in, settle fast (attack ~2 f, release ~3 f), the UI-explainer feel. */
    ease: z.enum(["smootherstep", "smoothstep", "easeInOut", "spring", "expoOut", "linear"]),
    /** Faster than this at 720p and a move becomes a cut. */
    peak_px_per_frame_720: z.number().min(1).max(500),
    push_in_pct_per_frame: range(0, 5),
    punch_pct_per_frame: z.number().min(0).max(10),
    max_static_frames: z.number().int().min(0).max(240),
    roll: z.object({ deg: range(0, 45), frames: z.number().int().min(1).max(240), per_10s: z.number().min(0).max(20) }),
    kick: z.object({ decay_frames: z.number().int().min(0).max(60), px: z.number().min(0).max(50), sign_flip_every_frame: z.boolean() }),
    whip: z.object({ per_min: z.number().min(0).max(20), px_per_frame: range(0, 300), motion_blur: z.boolean() }),
    handheld: z.number().min(0).max(1),
  }),
  framing: z.object(Object.fromEntries(sizeValues.map((s) => [s, FramingRow])) as Record<string, typeof FramingRow>),
  focus: z.enum(["eyes", "subject", "none"]),
  foreground_props_share: z.number().min(0).max(1),
  sync: z.object({ reaction_lead_frames: range(0, 24), cut_on: z.enum(["word", "beat", "music"]) }),
  transitions: z.object({
    default: z.string().max(40),
    on_place_change: z.string().max(40),
    on_time_change: z.string().max(40),
    flash_after_hook: z.boolean(),
  }),
  qa: z.object({ frozen_frames_max: z.number().int().min(1).max(240), black_white_check: z.boolean(), speed_spike_check: z.boolean() }),
  readability_traps: z.array(z.string().max(300)).max(30),
  evidence: z.object({ source: z.string().max(300).optional(), report_md: z.string().optional(), verifier_scores: z.record(z.string(), z.number()).optional() }).optional(),
}).refine((p) => Math.abs(p.camera.hold_pct + p.camera.drift_pct + p.camera.move_pct - 100) <= 1, {
  message: "hold, drift and move must add up to 100%",
  path: ["camera"],
});
export type ScenePreset = z.infer<typeof ScenePreset>;

export type LibraryKind = "narrative" | "scene_preset";

/** Readable first error for the editor. */
export function firstIssue(r: { success: boolean; error?: z.ZodError }): string | null {
  if (r.success || !r.error) return null;
  const i = r.error.issues[0];
  return `${i.path.join(" › ") || "entry"}: ${i.message}`;
}
