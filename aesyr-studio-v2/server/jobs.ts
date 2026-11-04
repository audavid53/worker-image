// Motion job runner: Tripo, UniMate (RunPod GPU) and Blender (RunPod CPU, or local Blender in dev).
//
// Built for serverless hosting: no worker loops or long requests. A job is a short list of steps;
// each poll (GET /api/jobs/<id>) starts the current step or checks it once, then returns. Heavy work
// runs on Tripo or on RunPod endpoints that scale from zero, so the app itself stays stateless
// apart from the job store and the credit ledger, both behind interfaces (memory now, Supabase
// private.reserve_job / finish_job once hosted).
import { randomUUID } from "node:crypto";
import {
  MotionJobRequest,
  TRIPO_MODEL,
  TRIPO_RIG_MODEL,
  estimateCost,
  type JobStatus,
  type MotionJob,
  type MotionJobView,
  type MotionOutput,
} from "../shared/motion";
import { ApiError } from "./openai";
import { readMedia, saveModel } from "./media";
import { findBlender, runBlenderLocal } from "./providers/blender-local";
import { RunpodClient } from "./providers/runpod";
import { TripoClient, type TripoTask } from "./providers/tripo";

export interface MotionEnv {
  TRIPO_API_KEY?: string;
  RUNPOD_API_KEY?: string;
  RUNPOD_BLENDER_ENDPOINT_ID?: string;
  RUNPOD_UNIMATE_ENDPOINT_ID?: string;
  BLENDER_PATH?: string;
  MEDIA_DIR?: string;
  DEV_CREDITS?: string;
}

// ---------- storage + credits (interfaces; memory implementations for local dev) ----------

type StepName = "tripo_model" | "tripo_rig" | "tripo_retarget" | "unimate" | "blender";
interface Step {
  name: StepName;
  ref?: string; // provider task / job id once started
  progress: number;
  done: boolean;
}
export interface JobRecord {
  id: string;
  userId: string;
  job: MotionJob;
  status: JobStatus;
  steps: Step[];
  outputs: MotionOutput[];
  /** What later steps need: Tripo task ids and short-lived provider URLs. */
  ctx: { modelTask?: string; rigTask?: string; modelUrl?: string; rigUrl?: string; uploaded?: string };
  cost: number;
  error?: string;
  createdAt: number;
}

export interface JobStore {
  get(id: string): Promise<JobRecord | undefined>;
  put(job: JobRecord): Promise<void>;
  byKey(userId: string, key: string): Promise<JobRecord | undefined>;
  setKey(userId: string, key: string, id: string): Promise<void>;
}
export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, JobRecord>();
  private keys = new Map<string, string>();
  async get(id: string) {
    return this.jobs.get(id);
  }
  async put(job: JobRecord) {
    this.jobs.set(job.id, job);
  }
  async byKey(userId: string, key: string) {
    const id = this.keys.get(`${userId}:${key}`);
    return id ? this.jobs.get(id) : undefined;
  }
  async setKey(userId: string, key: string, id: string) {
    this.keys.set(`${userId}:${key}`, id);
  }
}

/** Mirrors private.reserve_job / finish_job: reserve the estimate, then charge it or refund it. */
export interface CreditLedger {
  reserve(userId: string, jobId: string, cost: number): Promise<void>;
  finish(userId: string, jobId: string, ok: boolean): Promise<void>;
  balance(userId: string): Promise<number>;
}
export class MemoryLedger implements CreditLedger {
  private entries: { userId: string; jobId: string; delta: number; reason: string }[] = [];
  constructor(private grant = 1000) {}
  async balance(userId: string) {
    return this.grant + this.entries.filter((e) => e.userId === userId).reduce((s, e) => s + e.delta, 0);
  }
  async reserve(userId: string, jobId: string, cost: number) {
    const have = await this.balance(userId);
    if (have < cost) throw new ApiError(402, `Not enough credits: ${have} left, this needs ${cost}.`);
    this.entries.push({ userId, jobId, delta: -cost, reason: "reserve" });
  }
  async finish(userId: string, jobId: string, ok: boolean) {
    if (ok || this.entries.some((e) => e.jobId === jobId && e.reason === "refund")) return; // reserve stands as the charge
    const reserved = this.entries.filter((e) => e.jobId === jobId && e.reason === "reserve").reduce((s, e) => s - e.delta, 0);
    if (reserved) this.entries.push({ userId, jobId, delta: reserved, reason: "refund" });
  }
}

// ---------- the runner ----------

const MAX_INLINE_MODEL = 7 * 1024 * 1024; // base64 must fit RunPod's 10 MB job payload
const STEP_LABEL: Record<StepName, string> = {
  tripo_model: "Generating the model (Tripo)",
  tripo_rig: "Rigging (Tripo)",
  tripo_retarget: "Adding preset clips (Tripo)",
  unimate: "Generating motion (UniMate)",
  blender: "Animating (Blender)",
};

function planSteps(job: MotionJob): StepName[] {
  switch (job.kind) {
    case "tripo_character":
      return ["tripo_model", "tripo_rig", ...(job.presets.length ? (["tripo_retarget"] as const) : [])];
    case "tripo_rig":
      return ["tripo_rig", ...(job.presets.length ? (["tripo_retarget"] as const) : [])];
    case "unimate_motion":
      return ["unimate"];
    case "blender_motion":
      return ["blender"];
  }
}

export interface RunnerDeps {
  env: MotionEnv;
  store?: JobStore;
  ledger?: CreditLedger;
  fetchImpl?: typeof fetch;
}

export class MotionJobs {
  readonly store: JobStore;
  readonly ledger: CreditLedger;
  private env: MotionEnv;
  private fetchImpl: typeof fetch;
  private busy = new Set<string>(); // one advance per job at a time
  private local = new Map<string, Promise<{ glb: Uint8Array; clips: string[] }>>();
  private localDone = new Map<string, { glb: Uint8Array; clips: string[] } | Error>();

  constructor(deps: RunnerDeps) {
    this.env = deps.env;
    this.store = deps.store ?? new MemoryJobStore();
    this.ledger = deps.ledger ?? new MemoryLedger(Number(deps.env.DEV_CREDITS ?? 1000));
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private tripo() {
    return new TripoClient(this.env.TRIPO_API_KEY ?? "", this.fetchImpl);
  }
  private runpod() {
    return new RunpodClient(this.env.RUNPOD_API_KEY ?? "", this.fetchImpl);
  }

  /** Validates, checks the provider is configured, reserves credits, and queues the job. */
  async create(userId: string, body: unknown, idempotencyKey?: string): Promise<MotionJobView> {
    const parsed = MotionJobRequest.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid motion request");
    const job = parsed.data;
    if (idempotencyKey) {
      const existing = await this.store.byKey(userId, idempotencyKey);
      if (existing) return this.view(existing);
    }
    this.assertConfigured(job);
    const record: JobRecord = {
      id: randomUUID(),
      userId,
      job,
      status: "queued",
      steps: planSteps(job).map((name) => ({ name, progress: 0, done: false })),
      outputs: [],
      ctx: {},
      cost: estimateCost(job),
      createdAt: Date.now(),
    };
    await this.ledger.reserve(userId, record.id, record.cost);
    await this.store.put(record);
    if (idempotencyKey) await this.store.setKey(userId, idempotencyKey, record.id);
    return this.view(record);
  }

  private assertConfigured(job: MotionJob) {
    const kinds = planSteps(job);
    if (kinds.some((k) => k.startsWith("tripo")) && !this.env.TRIPO_API_KEY) throw new ApiError(503, "Set TRIPO_API_KEY in .env.local to use Tripo.");
    if (kinds.includes("unimate") && !(this.env.RUNPOD_API_KEY && this.env.RUNPOD_UNIMATE_ENDPOINT_ID))
      throw new ApiError(503, "Text-to-motion runs on RunPod: set RUNPOD_API_KEY and RUNPOD_UNIMATE_ENDPOINT_ID.");
    if (kinds.includes("blender") && !(this.env.RUNPOD_API_KEY && this.env.RUNPOD_BLENDER_ENDPOINT_ID) && !findBlender(this.env.BLENDER_PATH))
      throw new ApiError(503, "Object motion needs RUNPOD_BLENDER_ENDPOINT_ID, or Blender installed locally (BLENDER_PATH).");
  }

  async get(userId: string, id: string): Promise<MotionJobView> {
    const record = await this.store.get(id);
    if (!record || record.userId !== userId) throw new ApiError(404, "No such job");
    if ((record.status === "queued" || record.status === "running") && !this.busy.has(id)) {
      this.busy.add(id);
      try {
        await this.advance(record);
      } finally {
        this.busy.delete(id);
      }
    }
    return this.view(record);
  }

  async cancel(userId: string, id: string): Promise<MotionJobView> {
    const record = await this.store.get(id);
    if (!record || record.userId !== userId) throw new ApiError(404, "No such job");
    if (record.status === "queued" || record.status === "running") {
      const step = record.steps.find((s) => !s.done);
      if (step?.ref && (step.name === "unimate" || (step.name === "blender" && this.env.RUNPOD_BLENDER_ENDPOINT_ID))) {
        const endpoint = step.name === "unimate" ? this.env.RUNPOD_UNIMATE_ENDPOINT_ID! : this.env.RUNPOD_BLENDER_ENDPOINT_ID!;
        await this.runpod().cancel(endpoint, step.ref).catch(() => undefined);
      }
      record.status = "cancelled";
      await this.ledger.finish(record.userId, record.id, false);
      await this.store.put(record);
    }
    return this.view(record);
  }

  private view(r: JobRecord): MotionJobView {
    const current = r.steps.find((s) => !s.done);
    const progress = Math.round((r.steps.reduce((s, x) => s + (x.done ? 100 : x.progress), 0) / (r.steps.length * 100)) * 100);
    return {
      id: r.id,
      kind: r.job.kind,
      status: r.status,
      step: r.status === "succeeded" ? "Done" : current ? STEP_LABEL[current.name] : "",
      progress: r.status === "succeeded" ? 100 : progress,
      outputs: r.outputs,
      error: r.error,
      cost: r.cost,
    };
  }

  private async advance(r: JobRecord) {
    try {
      const step = r.steps.find((s) => !s.done);
      if (!step) return;
      r.status = "running";
      if (!step.ref) step.ref = await this.start(r, step);
      else await this.check(r, step);
      if (r.steps.every((s) => s.done)) {
        r.status = "succeeded";
        await this.ledger.finish(r.userId, r.id, true);
      }
    } catch (e) {
      r.status = "failed";
      r.error = e instanceof ApiError ? e.message : "The job failed";
      if (!(e instanceof ApiError)) console.error("[motion job]", r.id, e);
      await this.ledger.finish(r.userId, r.id, false);
    }
    await this.store.put(r);
  }

  // ----- starting steps -----

  private async start(r: JobRecord, step: Step): Promise<string> {
    const job = r.job;
    switch (step.name) {
      case "tripo_model": {
        if (job.kind !== "tripo_character") throw new Error("bad plan");
        const opts = { model: TRIPO_MODEL, faceLimit: job.faceLimit };
        if (!job.imageUrl) return this.tripo().textToModel(job.prompt, opts);
        const input = job.imageUrl.startsWith("/media/")
          ? await this.tripo().upload(await readMedia(job.imageUrl, this.env), "reference" + job.imageUrl.slice(-4), `image/${job.imageUrl.endsWith("jpg") ? "jpeg" : job.imageUrl.slice(-3)}`)
          : job.imageUrl;
        return this.tripo().imageToModel(input, opts);
      }
      case "tripo_rig": {
        if (job.kind !== "tripo_character" && job.kind !== "tripo_rig") throw new Error("bad plan");
        let input = r.ctx.modelTask;
        if (job.kind === "tripo_rig")
          input = job.model.startsWith("/media/") ? await this.tripo().upload(await readMedia(job.model, this.env), "model.glb", "model/gltf-binary") : job.model;
        return this.tripo().rig(input!, { model: TRIPO_RIG_MODEL, rigType: job.rigType });
      }
      case "tripo_retarget": {
        if (job.kind !== "tripo_character" && job.kind !== "tripo_rig") throw new Error("bad plan");
        return this.tripo().retarget(r.ctx.rigTask!, job.presets);
      }
      case "unimate": {
        if (job.kind !== "unimate_motion") throw new Error("bad plan");
        const input = {
          ...(await this.workerModel(job.model)),
          prompts: job.prompts,
          num_repetitions: job.takes,
          cfg_scale: job.cfgScale,
          ...(job.faceRight && job.faceLeft ? { face_r: job.faceRight, face_l: job.faceLeft } : {}),
        };
        return this.runpod().run(this.env.RUNPOD_UNIMATE_ENDPOINT_ID!, input, { executionTimeout: 20 * 60_000, ttl: 60 * 60_000 });
      }
      case "blender": {
        if (job.kind !== "blender_motion") throw new Error("bad plan");
        if (this.env.RUNPOD_API_KEY && this.env.RUNPOD_BLENDER_ENDPOINT_ID) {
          const sources = await Promise.all(
            job.sources.map(async (s) => {
              const m = await this.workerModel(s.model);
              if (!("model_url" in m)) throw new ApiError(400, "Clip sources must be HTTPS links on RunPod until hosted storage exists.");
              return { url: m.model_url, name: s.name };
            }),
          );
          return this.runpod().run(this.env.RUNPOD_BLENDER_ENDPOINT_ID, { ...(await this.workerModel(job.model)), recipe: job.recipe, sources }, { executionTimeout: 10 * 60_000, ttl: 30 * 60_000 });
        }
        const blender = findBlender(this.env.BLENDER_PATH)!;
        const model = await this.bytes(job.model);
        const sources = await Promise.all(job.sources.map(async (s) => ({ bytes: await this.bytes(s.model), name: s.name })));
        const ref = `local-${randomUUID()}`;
        const run = runBlenderLocal(blender, model, job.recipe, sources);
        this.local.set(ref, run);
        run.then(
          (v) => this.localDone.set(ref, v),
          (e) => this.localDone.set(ref, e instanceof Error ? e : new Error(String(e))),
        );
        return ref;
      }
    }
  }

  /** How a RunPod worker receives a model: a public URL, or the bytes for small local files. */
  private async workerModel(ref: string): Promise<{ model_url: string } | { model_b64: string }> {
    if (ref.startsWith("https://")) return { model_url: ref };
    const bytes = await readMedia(ref, this.env);
    if (bytes.length > MAX_INLINE_MODEL)
      throw new ApiError(413, "This model is over 7 MB; RunPod needs a public link to it, which arrives with hosted storage.");
    return { model_b64: Buffer.from(bytes).toString("base64") };
  }

  private async bytes(ref: string) {
    if (!ref.startsWith("https://")) return readMedia(ref, this.env);
    const res = await this.fetchImpl(ref);
    if (!res.ok) throw new ApiError(502, `Could not download the model (HTTP ${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ----- checking steps -----

  private async check(r: JobRecord, step: Step) {
    if (step.name.startsWith("tripo")) return this.checkTripo(r, step, await this.tripo().getTask(step.ref!));
    if (step.name === "blender" && step.ref!.startsWith("local-")) {
      const result = this.localDone.get(step.ref!);
      if (!result) {
        if (!this.local.has(step.ref!)) throw new ApiError(500, "The local Blender run was lost (server restarted). Try again.");
        step.progress = Math.min(90, step.progress + 10);
        return;
      }
      this.local.delete(step.ref!);
      this.localDone.delete(step.ref!);
      if (result instanceof Error) throw result instanceof ApiError ? result : new ApiError(500, result.message);
      return this.finishBlender(r, step, result.glb, result.clips);
    }
    const endpoint = step.name === "unimate" ? this.env.RUNPOD_UNIMATE_ENDPOINT_ID! : this.env.RUNPOD_BLENDER_ENDPOINT_ID!;
    const res = await this.runpod().status<{
      glb_b64?: string;
      clips?: string[];
      motions?: { prompt: string; take: number; glb_b64?: string }[];
    }>(endpoint, step.ref!);
    if (res.status === "IN_QUEUE") return void (step.progress = 5);
    if (res.status === "IN_PROGRESS") return void (step.progress = Math.min(90, Math.max(20, step.progress + 8)));
    if (res.status !== "COMPLETED") throw new ApiError(502, res.error ? `Worker failed: ${res.error.slice(0, 400)}` : `Worker ${res.status.toLowerCase()}`);
    if (step.name === "blender") {
      if (!res.output?.glb_b64) throw new ApiError(502, "The Blender worker returned no model.");
      return this.finishBlender(r, step, Buffer.from(res.output.glb_b64, "base64"), res.output.clips ?? []);
    }
    for (const m of res.output?.motions ?? []) {
      if (!m.glb_b64) continue;
      const saved = await saveModel(Buffer.from(m.glb_b64, "base64"), this.env);
      r.outputs.push({ url: saved.url, role: "motion", prompt: m.prompt, clips: [`${m.prompt.replace(/^An object /i, "").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 50)} ${m.take}`.trim()] });
    }
    if (!r.outputs.some((o) => o.role === "motion")) throw new ApiError(502, "UniMate returned no motions.");
    step.done = true;
  }

  private async finishBlender(r: JobRecord, step: Step, glb: Uint8Array, clips: string[]) {
    const saved = await saveModel(glb, this.env);
    r.outputs.push({ url: saved.url, role: "animated", clips });
    step.done = true;
  }

  private async checkTripo(r: JobRecord, step: Step, task: TripoTask) {
    step.progress = task.progress;
    if (task.status === "queued" || task.status === "running") return;
    if (task.status !== "success") throw new ApiError(502, `Tripo ${task.status}${task.error ? `: ${task.error}` : ""}`);
    const url = task.output?.model_url;
    if (!url) throw new ApiError(502, "Tripo returned no model.");
    // Tripo URLs expire: copy the model into our storage now.
    const saved = await saveModel(await this.bytes(url), this.env);
    const job = r.job;
    if (step.name === "tripo_model") {
      r.ctx.modelTask = step.ref;
      r.ctx.modelUrl = url;
      r.outputs.push({ url: saved.url, role: "model" });
    } else if (step.name === "tripo_rig") {
      r.ctx.rigTask = step.ref;
      r.ctx.rigUrl = url;
      r.outputs.push({ url: saved.url, role: "rigged" });
    } else {
      r.outputs.push({ url: saved.url, role: "animated", clips: "presets" in job ? job.presets : [] });
    }
    step.done = true;
  }
}
