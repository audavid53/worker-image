// Dev-only API: serves /api/* and generated /media/* from the Vite dev server so provider keys
// stay server-side. Hosting moves these handlers to serverless functions (milestone 12).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";
import { generateCode3D, generateImage, generateScript } from "./casting";
import { ApiError, type ProviderEnv } from "./openai";
import { generateStory } from "./story";
import { MAX_AUDIO_BYTES, saveAudio } from "./media";

const MAX_BODY = 256 * 1024;

function readBytes(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, "Audio files are limited to 50 MB"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, "Request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "Body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

const ROUTES: Record<string, (body: unknown, env: ProviderEnv) => Promise<unknown>> = {
  "/api/story": generateStory,
  "/api/script": generateScript,
  "/api/image": generateImage,
  "/api/code3d": generateCode3D,
};

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

export function devApi(env: ProviderEnv): Plugin {
  const mediaDir = env.MEDIA_DIR ?? ".local-media";
  return {
    name: "aesyr-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = (req.url ?? "").split("?")[0];
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };

        // Generated media: only flat <uuid>.<ext> names, so no path traversal.
        const media = url.match(/^\/media\/([0-9a-f-]{36})\.(png|jpg|webp|wav|mp3|ogg|m4a)$/);
        if (media) {
          const file = join(mediaDir, `${media[1]}.${media[2]}`);
          try {
            await stat(file);
            res.setHeader("content-type", MEDIA_TYPES[media[2]]);
            res.setHeader("cache-control", "private, max-age=31536000, immutable");
            createReadStream(file).pipe(res);
          } catch {
            send(404, { error: "Not found" });
          }
          return;
        }

        // Raw-body upload (not JSON) for timeline audio.
        if (url === "/api/upload-audio") {
          if (req.method !== "POST") return send(405, { error: "Use POST" });
          try {
            send(200, await saveAudio(await readBytes(req, MAX_AUDIO_BYTES), env));
          } catch (e) {
            send(e instanceof ApiError ? e.status : 500, { error: e instanceof ApiError ? e.message : "Upload failed" });
          }
          return;
        }

        const handler = ROUTES[url];
        if (!handler) return next();
        if (req.method !== "POST") return send(405, { error: "Use POST" });
        try {
          send(200, await handler(await readJson(req), env));
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 500;
          if (status === 500) server.config.logger.error(String(e));
          send(status, { error: e instanceof ApiError ? e.message : "Generation failed" });
        }
      });
    },
  };
}
