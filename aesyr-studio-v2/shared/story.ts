// Story generation contract shared by the client and the /api/story endpoint.
import { z } from "zod";

export const ASPECT_RATIOS = ["16:9", "2.39:1", "9:16", "1:1", "4:5"] as const;

export const StoryRequest = z.object({
  projectName: z.string().trim().min(1).max(120),
  aspectRatio: z.enum(ASPECT_RATIOS),
  narrativeId: z.string().min(1).max(60),
  scenePresetId: z.string().min(1).max(60),
  runtimeSeconds: z.number().int().min(10).max(7200),
  idea: z.string().trim().min(1).max(60_000),
});
export type StoryRequest = z.infer<typeof StoryRequest>;

export const GeneratedBeat = z.object({
  key: z.string().max(60),
  act: z.string().max(60),
  name: z.string().max(80),
  summary: z.string().max(2000),
  share: z.number().min(0).max(1),
});

export const GeneratedCharacter = z.object({
  name: z.string().min(1).max(80),
  role: z.string().max(80),
  description: z.string().max(1500),
  want: z.string().max(500),
  need: z.string().max(500),
  arc: z.string().max(800),
});

export const GeneratedRelationship = z.object({
  from: z.string().max(80),
  to: z.string().max(80),
  label: z.string().max(80),
});

export const StoryDraft = z.object({
  logline: z.string().max(400),
  beats: z.array(GeneratedBeat).min(1).max(40),
  characters: z.array(GeneratedCharacter).max(24),
  relationships: z.array(GeneratedRelationship).max(60),
});
export type StoryDraft = z.infer<typeof StoryDraft>;

export interface StoryResponse {
  draft: StoryDraft;
  /** "openai" when a model wrote it; "offline" when no API key is configured. */
  source: "openai" | "offline";
  model?: string;
}
