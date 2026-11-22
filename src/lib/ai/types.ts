import { z } from "zod";
import type { Script, Structure, Tone } from "@/lib/script/schema";

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
  /** Structure et ton imposés par le créateur ("auto" : l'IA choisit). */
  structure?: Structure;
  tone?: Tone;
  assets: AssetSummary[];
};

export type ReviseRequest = {
  script: Script;
  assets: AssetSummary[];
  /** Demande de correction du créateur, en langage naturel. */
  instruction: string;
  /** Scène à refaire, si la demande porte sur une seule partie. */
  sceneId?: string;
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
  /**
   * Écrit le script détaillé complet (texte, fonds, effets, transitions, personnage, musique)
   * en un seul appel : le montage s'en sert ensuite sans rappeler l'IA.
   */
  generateScript(req: ScriptRequest): Promise<Script>;
  /**
   * Corrige les choix de montage (pas le texte, déjà enregistré) d'après une demande du créateur.
   * Ne renvoie que les scènes modifiées, fusionnées dans le script.
   */
  reviseScript(req: ReviseRequest): Promise<Script>;
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
