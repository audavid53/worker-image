// Tripo v3 API client (https://developers.tripo3d.ai). Server-only: the key never reaches the browser.
// Every call creates an async task; poll getTask until it is terminal.
import { ApiError } from "../openai";

export const TRIPO_BASE = "https://openapi.tripo3d.ai/v3";

export type TripoStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export interface TripoTask {
  status: TripoStatus;
  progress: number;
  output?: { model_url?: string; rendered_image_url?: string; riggable?: boolean; rig_type?: string };
  error?: string;
  credits?: number;
}

export class TripoClient {
  constructor(
    private key: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!key) throw new ApiError(503, "Set TRIPO_API_KEY in .env.local to use Tripo.");
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${TRIPO_BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.key}`, ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...init.headers },
    });
    let body: { code?: number; data?: T; message?: string; suggestion?: string };
    try {
      body = await res.json();
    } catch {
      throw new ApiError(502, `Tripo returned HTTP ${res.status}.`);
    }
    if (!res.ok || body.code !== 0) {
      // 2010: not enough Tripo credit on the API account (the app's own credits are separate).
      const status = body.code === 2010 ? 402 : res.status === 401 || res.status === 403 ? 503 : res.status === 429 ? 429 : 502;
      const msg = body.code === 2010 ? "The Tripo API account is out of credit. Top it up in the Tripo console." : body.message || `Tripo error ${body.code ?? res.status}`;
      throw new ApiError(status, msg);
    }
    return body.data as T;
  }

  private async task(path: string, body: Record<string, unknown>): Promise<string> {
    const data = await this.call<{ task_id: string }>(path, { method: "POST", body: JSON.stringify(body) });
    if (!data?.task_id) throw new ApiError(502, "Tripo did not return a task id.");
    return data.task_id;
  }

  textToModel(prompt: string, opts: { model: string; faceLimit?: number }) {
    return this.task("/generation/text-to-model", { prompt, model: opts.model, face_limit: opts.faceLimit, texture: true, pbr: true });
  }
  /** input: a public image URL, a file_token, or a text_to_image task id. */
  imageToModel(input: string, opts: { model: string; faceLimit?: number }) {
    return this.task("/generation/image-to-model", { input, model: opts.model, face_limit: opts.faceLimit, texture: true, pbr: true });
  }
  /** input: a generation task id, a file_token, or a public model URL. */
  rig(input: string, opts: { model: string; rigType: string }) {
    return this.task("/animations/rig", { input, model: opts.model, rig_type: opts.rigType, out_format: "glb" });
  }
  /** input: the rig task id. Presets are sent as "preset:<name>". */
  retarget(rigTaskId: string, presets: string[], inPlace = false) {
    const ids = presets.map((p) => `preset:${p}`);
    return this.task("/animations/retarget", { input: rigTaskId, ...(ids.length === 1 ? { animation: ids[0] } : { animations: ids }), out_format: "glb", animate_in_place: inPlace });
  }

  async upload(bytes: Uint8Array, filename: string, type: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type }), filename);
    const data = await this.call<{ file_token: string }>("/files", { method: "POST", body: form });
    return data.file_token;
  }

  async getTask(id: string): Promise<TripoTask> {
    const d = await this.call<{ status: string; progress?: number; output?: TripoTask["output"]; error_message?: string; credits_consumed?: number }>(
      `/tasks/${encodeURIComponent(id)}`,
    );
    // Unknown, banned or expired statuses: banned/expired are terminal failures, anything else keeps polling.
    const status: TripoStatus = ["queued", "running", "success", "failed", "cancelled"].includes(d.status)
      ? (d.status as TripoStatus)
      : d.status === "banned" || d.status === "expired"
        ? "failed"
        : "running";
    return { status, progress: d.progress ?? 0, output: d.output, error: d.error_message, credits: d.credits_consumed };
  }

  balance() {
    return this.call<{ balance: number; frozen: number }>("/account/balance");
  }
}
