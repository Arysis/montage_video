import { z } from "zod";
import type { Directions } from "@/lib/plan/directions";
import type { Script } from "@/lib/script/schema";

export type AssetSummary = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  durationSec: number | null;
};

export type ScriptRequest = {
  idea: string;
  format: string;
  platforms: string[];
  targetDurationSec: number;
  assets: AssetSummary[];
};

export type DirectionRequest = {
  script: Script;
  /** Durée de chaque scène, calculée sur la voix. */
  sceneDurations: { sceneId: string; durationSec: number }[];
  assets: AssetSummary[];
  /** Demande de correction de l'utilisateur, en langage naturel. */
  instruction?: string;
  /** Scène à refaire, si la demande porte sur une seule partie. */
  sceneId?: string;
  previous?: Directions;
};

export const reviewIssueSchema = z.object({
  sceneId: z.string(),
  severity: z.enum(["warn", "fail"]),
  title: z.string().max(80),
  detail: z.string().max(200),
});
export const reviewSchema = z.object({ issues: z.array(reviewIssueSchema).max(12) });
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

export const captionSchema = z.object({
  caption: z.string().max(2200),
  hashtags: z.array(z.string()).max(10),
});
export type Caption = z.infer<typeof captionSchema>;

export const assetDescriptionSchema = z.object({ description: z.string().max(300) });

export interface AiProvider {
  readonly name: string;
  generateScript(req: ScriptRequest): Promise<Script>;
  directMontage(req: DirectionRequest): Promise<Directions>;
  reviewFrames(req: {
    script: Script;
    frames: { sceneId: string; jpeg: Buffer; spokenText: string }[];
  }): Promise<ReviewIssue[] | null>;
  proposeCaption(req: { script: Script; platforms: string[]; previous?: string }): Promise<Caption>;
  describeImage(req: { jpeg: Buffer; name: string; kind: string }): Promise<string | null>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("L'IA n'est pas configurée sur ce serveur.");
  }
}
