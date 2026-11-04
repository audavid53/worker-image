// Shared OpenAI Responses API call with a strict JSON-schema output. Server-only.
import type { z } from "zod";

export interface ProviderEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_IMAGE_MODEL?: string;
  MEDIA_DIR?: string;
}

export const DEFAULT_MODEL = "gpt-5-mini";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ResponsesOutput {
  status?: string;
  incomplete_details?: { reason?: string };
  error?: { message?: string };
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
}

export async function openaiJson<T>(opts: {
  env: ProviderEnv;
  fetchImpl: typeof fetch;
  name: string;
  schema: object;
  instructions: string;
  input: string;
  validate: z.ZodType<T>;
  timeoutMs?: number;
}): Promise<{ data: T; model: string }> {
  const model = opts.env.OPENAI_MODEL || DEFAULT_MODEL;
  const res = await opts.fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    body: JSON.stringify({
      model,
      instructions: opts.instructions,
      input: opts.input,
      text: { format: { type: "json_schema", name: opts.name, strict: true, schema: opts.schema } },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as ResponsesOutput;
  if (!res.ok) throw new ApiError(502, `OpenAI request failed (${res.status}): ${body.error?.message ?? "unknown error"}`);
  if (body.status === "incomplete") throw new ApiError(502, `OpenAI response incomplete: ${body.incomplete_details?.reason ?? "unknown"}`);

  const content = body.output?.find((o) => o.type === "message")?.content ?? [];
  const refusal = content.find((c) => c.type === "refusal")?.refusal;
  if (refusal) throw new ApiError(422, `The model declined: ${refusal}`);
  const text = content.find((c) => c.type === "output_text")?.text;
  if (!text) throw new ApiError(502, "OpenAI returned no text");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(502, "OpenAI returned malformed JSON");
  }
  const parsed = opts.validate.safeParse(json);
  if (!parsed.success) throw new ApiError(502, "OpenAI returned output that failed validation");
  return { data: parsed.data, model };
}

/** Strict-schema helpers: every property required, no extras. */
export const s = {
  str: () => ({ type: "string" }),
  num: () => ({ type: "number" }),
  enum: (values: readonly string[]) => ({ type: "string", enum: values }),
  arr: (items: object) => ({ type: "array", items }),
  obj: (properties: Record<string, object>) => ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }),
};
