// Uploaded and generated media. Bytes are sniffed, not trusted from the name or Content-Type,
// and stored under an unguessable flat name (no user-controlled paths).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ApiError, type ProviderEnv } from "./openai";

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export const AUDIO_TYPES = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4" } as const;
export type AudioExt = keyof typeof AUDIO_TYPES;

/** Identifies an audio container from its first bytes. */
export function sniffAudio(b: Uint8Array): AudioExt | null {
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (b.length >= 4 && ascii(0, 4) === "OggS") return "ogg";
  if (b.length >= 12 && ascii(4, 4) === "ftyp") return "m4a";
  if (b.length >= 3 && ascii(0, 3) === "ID3") return "mp3";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3"; // MPEG frame sync
  return null;
}

export async function saveAudio(bytes: Uint8Array, env: ProviderEnv) {
  if (!bytes.length) throw new ApiError(400, "Empty file");
  if (bytes.length > MAX_AUDIO_BYTES) throw new ApiError(413, "Audio files are limited to 50 MB");
  const ext = sniffAudio(bytes);
  if (!ext) throw new ApiError(415, "Unsupported audio: use WAV, MP3, OGG or M4A");
  const dir = env.MEDIA_DIR ?? ".local-media";
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, file), bytes);
  return { url: `/media/${file}` };
}

// ---------- 3D models (motion jobs) ----------

export const MAX_MODEL_BYTES = 150 * 1024 * 1024;

/** True for a binary glTF ("glTF" magic, version 2). */
export function isGlb(b: Uint8Array) {
  return b.length >= 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46 && b[4] === 2;
}

export async function saveModel(bytes: Uint8Array, env: ProviderEnv) {
  if (!isGlb(bytes)) throw new ApiError(502, "The provider did not return a GLB model");
  if (bytes.length > MAX_MODEL_BYTES) throw new ApiError(413, "Models are limited to 150 MB");
  const dir = env.MEDIA_DIR ?? ".local-media";
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.glb`;
  await writeFile(join(dir, file), bytes);
  return { url: `/media/${file}` };
}

/** Reads generated media by its "/media/<uuid>.<ext>" URL (flat names only, so no traversal). */
export async function readMedia(url: string, env: ProviderEnv): Promise<Uint8Array> {
  const m = url.match(/^\/media\/([0-9a-f-]{36}\.(glb|png|jpg|webp))$/);
  if (!m) throw new ApiError(400, "Not a generated media URL");
  try {
    return new Uint8Array(await readFile(join(env.MEDIA_DIR ?? ".local-media", m[1])));
  } catch {
    throw new ApiError(404, "That model is no longer stored");
  }
}
