// Local Blender runner for development: the same recipes.py the RunPod CPU worker runs,
// on this machine's Blender. Used when RUNPOD_BLENDER_ENDPOINT_ID is not set.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ApiError } from "../openai";

const RECIPES = resolve("workers/blender/recipes.py");
const COMMON = [
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
  "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe",
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "/usr/bin/blender",
];

export function findBlender(configured?: string): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  return COMMON.find((p) => existsSync(p)) ?? null;
}

/** Runs one recipe. Inputs are GLB bytes; returns the GLB and its clip names. */
export async function runBlenderLocal(
  blender: string,
  model: Uint8Array,
  recipe: Record<string, unknown>,
  sources: { bytes: Uint8Array; name?: string }[] = [],
  timeoutMs = 10 * 60_000,
): Promise<{ glb: Uint8Array; clips: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "aesyr-blender-"));
  try {
    const input = join(dir, "in.glb");
    const output = join(dir, "out.glb");
    await writeFile(input, model);
    const local = await Promise.all(
      sources.map(async (s, i) => {
        const path = join(dir, `clip${i}.glb`);
        await writeFile(path, s.bytes);
        return { path, name: s.name ?? "" };
      }),
    );
    const recipePath = join(dir, "recipe.json");
    await writeFile(recipePath, JSON.stringify(recipe.recipe === "merge-clips" ? { ...recipe, sources: local } : recipe));
    const args = ["-b", "--factory-startup", "--python-exit-code", "1", "--python", RECIPES, "--", input, output, recipePath];
    const log = await new Promise<string>((ok, fail) => {
      const child = spawn(blender, args, { windowsHide: true });
      let text = "";
      const keep = (b: Buffer) => (text = (text + b.toString()).slice(-4000));
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on("error", fail);
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? ok(text) : fail(new ApiError(500, `Blender failed: ${text.slice(-800)}`));
      });
    });
    if (!existsSync(output)) throw new ApiError(500, `Blender wrote no file: ${log.slice(-400)}`);
    const clips = JSON.parse(await readFile(output + ".json", "utf8")).clips as string[];
    return { glb: new Uint8Array(await readFile(output)), clips };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
