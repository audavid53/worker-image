// Motion jobs: give Casting models animation clips for the three.js scenes.
//
//   • Tripo      text/image → model → rig → preset clips (walk, run, idle, wave …)
//   • UniMate    text → motion for ANY rigged skeleton (RunPod GPU worker)
//   • Blender    preset or custom keyframed motion for objects, and clip merging (RunPod CPU worker)
//
// Every request is data checked here and again by the worker; no request ever carries code.
import { z } from "zod";

// ---------- shared pieces ----------

export const clipName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9 _-]+$/, "Clip names use letters, numbers, spaces, _ or -.");

/** A model the job reads: generated media (/media/<uuid>.glb) or an HTTPS URL. */
export const modelRef = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => /^\/media\/[0-9a-f-]{36}\.glb$/.test(s) || /^https:\/\/\S+$/.test(s), "Use a generated model or an HTTPS link.");

const n = (min: number, max: number) => z.number().finite().min(min).max(max);
const vec3 = z.tuple([n(-1000, 1000), n(-1000, 1000), n(-1000, 1000)]);

// ---------- Blender: object motion (fixed recipes in workers/blender/recipes.py) ----------

export const objectPresets = {
  spin: { label: "Spin", duration: 2, loop: true },
  bob: { label: "Bob up and down", duration: 1.6, loop: true },
  hover: { label: "Hover", duration: 3, loop: true },
  sway: { label: "Sway", duration: 2.4, loop: true },
  wobble: { label: "Wobble", duration: 0.8, loop: false },
  pulse: { label: "Pulse (scale)", duration: 1, loop: true },
  "pop-in": { label: "Pop in", duration: 0.5, loop: false },
  "door-swing": { label: "Door swing open", duration: 1.2, loop: false },
  "lid-open": { label: "Lid open", duration: 1, loop: false },
  "fall-over": { label: "Fall over", duration: 0.9, loop: false },
  "drive-forward": { label: "Drive forward", duration: 3, loop: false },
} as const;
export type ObjectPreset = keyof typeof objectPresets;

/** One key of a custom object clip: Studio axes (Y up, metres, radians), offsets from rest. */
export const keyframe = z
  .object({
    time: n(0, 60),
    position: vec3.optional(),
    rotation: vec3.optional(),
    scale: z.tuple([n(0.01, 100), n(0.01, 100), n(0.01, 100)]).optional(),
  })
  .strict()
  .refine((k) => k.position || k.rotation || k.scale, "Each key needs a position, rotation or scale.");

export const blenderRecipeSchema = z.discriminatedUnion("recipe", [
  z
    .object({
      recipe: z.literal("object-preset"),
      preset: z.enum(Object.keys(objectPresets) as [ObjectPreset, ...ObjectPreset[]]),
      name: clipName,
      duration: n(0.2, 30),
      loop: z.boolean(),
      axis: z.enum(["x", "y", "z"]).optional(),
      amount: n(0.01, 20).optional(),
    })
    .strict(),
  z
    .object({
      recipe: z.literal("keyframes"),
      name: clipName,
      duration: n(0.2, 60),
      loop: z.boolean(),
      keys: z.array(keyframe).min(2).max(120),
    })
    .strict()
    .superRefine((r, ctx) => {
      let previous = -1;
      for (const key of r.keys) {
        if (key.time <= previous || key.time > r.duration)
          ctx.addIssue({ code: "custom", message: "Keyframes must increase in time within the clip." });
        previous = key.time;
      }
    }),
  z.object({ recipe: z.literal("normalize"), triangleBudget: z.number().int().min(1000).max(200_000) }).strict(),
  z.object({ recipe: z.literal("merge-clips") }).strict(),
  // Drop finger / limb-twist / face bones, folding their skin weights into the kept parent.
  z.object({ recipe: z.literal("simplify-rig"), drop: z.array(z.enum(["fingers", "twist", "face"])).min(1).max(3) }).strict(),
]);
export type BlenderRecipe = z.infer<typeof blenderRecipeSchema>;

// ---------- Tripo: rigs and preset clips ----------

export const RIG_TYPES = ["biped", "quadruped", "hexapod", "octopod", "avian", "serpentine", "aquatic", "others"] as const;
export type RigType = (typeof RIG_TYPES)[number];
/** Rig v3.0 (default here; best for humanoids) and v2.5 share these presets. */
export const TRIPO_PRESETS: Record<RigType, readonly string[]> = {
  biped: ["idle", "walk", "run", "jump", "turn", "climb", "dive", "fall", "hurt", "slash", "shoot"],
  quadruped: ["quadruped:walk"],
  hexapod: ["hexapod:walk"],
  octopod: ["octopod:walk"],
  serpentine: ["serpentine:march"],
  aquatic: ["aquatic:march"],
  avian: [],
  others: [],
};
export const TRIPO_RIG_MODEL = "v3.0-20260909";
export const TRIPO_MODEL = "v3.1-20260211";
export const MAX_TRIPO_PRESETS = 5; // Tripo's own per-task limit

// ---------- job requests ----------

const presetsFor = (rigType: RigType, presets: string[], ctx: z.RefinementCtx) => {
  const allowed = TRIPO_PRESETS[rigType];
  for (const p of presets)
    if (!allowed.includes(p)) ctx.addIssue({ code: "custom", message: `"${p}" is not a ${rigType} preset.` });
};

export const MotionJobRequest = z.discriminatedUnion("kind", [
  // A new animated character: Tripo model → rig → preset clips.
  z
    .object({
      kind: z.literal("tripo_character"),
      prompt: z.string().trim().max(1000).default(""),
      imageUrl: z.string().trim().max(2000).regex(/^(https:\/\/\S+|\/media\/[0-9a-f-]{36}\.(png|jpg|webp))$/).optional(),
      rigType: z.enum(RIG_TYPES).default("biped"),
      presets: z.array(z.string()).max(MAX_TRIPO_PRESETS).default(["idle", "walk", "run"]),
      /** Clips play on the spot (no root travel); the timeline moves the character instead. */
      inPlace: z.boolean().default(false),
      faceLimit: z.number().int().min(2000).max(200_000).default(30_000), // web-friendly
    })
    .strict()
    .superRefine((r, ctx) => {
      if (!r.prompt && !r.imageUrl) ctx.addIssue({ code: "custom", message: "Describe the character or give an image." });
      presetsFor(r.rigType, r.presets, ctx);
    }),
  // Rig an existing model (and optionally add preset clips).
  z
    .object({
      kind: z.literal("tripo_rig"),
      model: modelRef,
      rigType: z.enum(RIG_TYPES).default("biped"),
      presets: z.array(z.string()).max(MAX_TRIPO_PRESETS).default([]),
      inPlace: z.boolean().default(false),
    })
    .strict()
    .superRefine((r, ctx) => presetsFor(r.rigType, r.presets, ctx)),
  // Text-to-motion for a rigged model (any skeleton): one GLB per prompt and take.
  z
    .object({
      kind: z.literal("unimate_motion"),
      model: modelRef,
      prompts: z.array(z.string().trim().min(3).max(200)).min(1).max(6),
      takes: z.number().int().min(1).max(3).default(1),
      cfgScale: n(1, 9).default(3),
      /** Run Blender simplify-rig first (UniMate takes ≤ 71 joints; Tripo bipeds have ~78). */
      simplifyRig: z.boolean().default(true),
      faceRight: z.string().regex(/^[\w .:|-]{1,80}$/).optional(),
      faceLeft: z.string().regex(/^[\w .:|-]{1,80}$/).optional(),
    })
    .strict(),
  // Object motion (preset or custom keys), decimation, or merging clips of one rig into one GLB.
  z
    .object({
      kind: z.literal("blender_motion"),
      model: modelRef,
      recipe: blenderRecipeSchema,
      sources: z.array(z.object({ model: modelRef, name: clipName.optional() }).strict()).max(24).default([]),
    })
    .strict()
    .superRefine((r, ctx) => {
      if ((r.recipe.recipe === "merge-clips") !== r.sources.length > 0)
        ctx.addIssue({ code: "custom", message: "merge-clips needs sources; other recipes take none." });
    }),
]);
export type MotionJobRequest = z.input<typeof MotionJobRequest>;
export type MotionJob = z.output<typeof MotionJobRequest>;
export type MotionJobKind = MotionJob["kind"];

// ---------- costs (app credits; providers bill us separately) ----------

export const MOTION_COST = {
  tripo_model: 30,
  tripo_rig: 25,
  tripo_retarget: 10, // per Tripo task (up to 5 presets)
  unimate_take: 4, // per prompt × take
  blender_recipe: 1,
} as const;

export function estimateCost(job: MotionJob): number {
  switch (job.kind) {
    case "tripo_character":
      return MOTION_COST.tripo_model + MOTION_COST.tripo_rig + (job.presets.length ? MOTION_COST.tripo_retarget : 0);
    case "tripo_rig":
      return MOTION_COST.tripo_rig + (job.presets.length ? MOTION_COST.tripo_retarget : 0);
    case "unimate_motion":
      return MOTION_COST.unimate_take * job.prompts.length * job.takes + (job.simplifyRig ? MOTION_COST.blender_recipe : 0);
    case "blender_motion":
      return MOTION_COST.blender_recipe;
  }
}

// ---------- job state the browser polls ----------

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface MotionOutput {
  /** "/media/<uuid>.glb" while local; a storage URL once hosted. */
  url: string;
  role: "model" | "rigged" | "animated" | "motion";
  clips?: string[];
  prompt?: string;
}
export interface MotionJobView {
  id: string;
  kind: MotionJobKind;
  status: JobStatus;
  step: string;
  progress: number; // 0–100 across all steps
  outputs: MotionOutput[];
  error?: string;
  cost: number;
}
