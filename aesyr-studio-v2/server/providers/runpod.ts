// RunPod Serverless queue endpoints (https://docs.runpod.io/serverless/endpoints/operations).
// Each worker (workers/blender, workers/unimate) is one endpoint that scales 0 → N workers on demand,
// so the app never holds a machine: it submits with /run and polls /status.
import { ApiError } from "../openai";

export const RUNPOD_API = "https://api.runpod.ai/v2";

export type RunpodStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export interface RunpodJob<T> {
  status: RunpodStatus;
  output?: T;
  error?: string;
}

export class RunpodClient {
  constructor(
    private key: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!key) throw new ApiError(503, "Set RUNPOD_API_KEY in .env.local to use RunPod workers.");
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json", ...init.headers },
    });
    if (res.status === 401) throw new ApiError(503, "RunPod rejected RUNPOD_API_KEY.");
    if (!res.ok) throw new ApiError(502, `RunPod returned HTTP ${res.status}.`);
    return (await res.json()) as T;
  }

  /** Queue a job. executionTimeout (ms) caps a stuck worker; ttl (ms) drops a job that never starts. */
  async run(endpointId: string, input: unknown, policy = { executionTimeout: 15 * 60_000, ttl: 60 * 60_000 }): Promise<string> {
    const body = await this.call<{ id?: string }>(`${RUNPOD_API}/${encodeURIComponent(endpointId)}/run`, {
      method: "POST",
      body: JSON.stringify({ input, policy }),
    });
    if (!body.id) throw new ApiError(502, "RunPod did not return a job id.");
    return body.id;
  }

  async status<T>(endpointId: string, jobId: string): Promise<RunpodJob<T>> {
    const body = await this.call<{ status: RunpodStatus; output?: T & { error?: string }; error?: string }>(
      `${RUNPOD_API}/${encodeURIComponent(endpointId)}/status/${encodeURIComponent(jobId)}`,
    );
    // Our handlers report their own failures as {error} inside a COMPLETED output.
    if (body.status === "COMPLETED" && body.output && typeof body.output === "object" && "error" in body.output && body.output.error)
      return { status: "FAILED", error: String(body.output.error) };
    return { status: body.status, output: body.output, error: body.error };
  }

  async cancel(endpointId: string, jobId: string) {
    await this.call(`${RUNPOD_API}/${encodeURIComponent(endpointId)}/cancel/${encodeURIComponent(jobId)}`, { method: "POST" });
  }
}
