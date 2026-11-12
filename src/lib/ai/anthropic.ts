import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { directionsSchema, type Directions } from "@/lib/plan/directions";
import { scriptSchema, type Script } from "@/lib/script/schema";
import {
  assetDescriptionSchema,
  captionSchema,
  type AiProvider,
  type AssetSummary,
  type Caption,
  type DirectionRequest,
  type ReviewIssue,
  reviewSchema,
  type ScriptRequest,
} from "./types";

const SYSTEM = `Tu es le monteur et scénariste d'une app qui fabrique des vidéos courtes (TikTok, Instagram Reels, YouTube Shorts) pour des créateurs solo.
Tu écris en français, au tutoiement si le créateur parle à son public de façon directe.
Règles d'écriture : phrases courtes (15 mots au plus), une accroche forte dans les 3 premières secondes, un appel à l'action clair à la fin.
Tu n'inventes jamais de chiffres, de témoignages ni de faits que le créateur n'a pas donnés.`;

type Content = Anthropic.Beta.Messages.BetaContentBlockParam;

function describeAssets(assets: AssetSummary[]): string {
  if (!assets.length) return "Aucun fichier fourni.";
  return assets
    .map(
      (a) =>
        `- id=${a.id} | type=${a.kind} | nom=${a.name}${a.durationSec ? ` | durée=${a.durationSec.toFixed(1)} s` : ""}${a.description ? ` | contenu : ${a.description}` : ""}`,
    )
    .join("\n");
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  /** Appel structuré : la réponse est validée par le schéma Zod. */
  private async ask<T extends z.ZodType>(
    schema: T,
    content: string | Content[],
    effort: "low" | "medium" | "high",
    maxTokens = 16000,
  ): Promise<z.infer<T>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort, format: zodOutputFormat(schema) },
      // Si un filtre de sécurité refuse la demande, l'API relance sur un modèle de repli.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("L'IA a refusé cette demande. Reformule ton idée.");
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new Error("Réponse de l'IA incomplète. Réessaie.");
    }
    return response.parsed_output as z.infer<T>;
  }

  async generateScript(req: ScriptRequest): Promise<Script> {
    const prompt = `Écris le script d'une vidéo à partir de cette idée.

Idée du créateur :
"""${req.idea}"""

Format : ${req.format}. Plateformes : ${req.platforms.join(", ") || "non précisées"}.
Durée visée : ${req.targetDurationSec} secondes, soit environ ${Math.round(req.targetDurationSec * 2.6)} mots dits à voix haute au total.

Fichiers du créateur (à utiliser en priorité dans les intentions visuelles) :
${describeAssets(req.assets)}

Découpe en 3 à 8 scènes. Pour chaque scène : le texte dit (1 à 3 phrases), l'intention visuelle, et un texte court à l'écran seulement s'il aide (sinon null).
Les ids de scène sont s1, s2, s3...
Propose aussi une légende pour la publication (2 phrases au plus) et 3 à 5 hashtags sans espace, avec le #.`;
    const script = await this.ask(scriptSchema, prompt, "medium");
    return { ...script, scenes: script.scenes.map((s, i) => ({ ...s, id: `s${i + 1}` })) };
  }

  async directMontage(req: DirectionRequest): Promise<Directions> {
    const scenes = req.script.scenes
      .map((s) => {
        const d = req.sceneDurations.find((x) => x.sceneId === s.id)?.durationSec ?? 0;
        return `- ${s.id} (${d.toFixed(1)} s) : dit « ${s.text} » ; intention visuelle : ${s.visualIntent}${s.onScreenText ? ` ; texte à l'écran : ${s.onScreenText}` : ""}`;
      })
      .join("\n");
    const correction = req.instruction
      ? `\nDemande de correction du créateur${req.sceneId ? ` (uniquement pour la scène ${req.sceneId}, garde les autres identiques)` : ""} :
"""${req.instruction}"""
Choix précédents : ${JSON.stringify(req.previous ?? null)}`
      : "";
    const prompt = `Décide le montage de cette vidéo.

Scènes :
${scenes}

Fichiers disponibles :
${describeAssets(req.assets)}

Pour chaque scène, choisis 1 à 4 fichiers visuels (vidéo, image, personnage ou logo) dans la liste, dans l'ordre d'apparition.
Une scène de plus de 4 secondes doit avoir au moins 2 visuels pour garder du rythme, si assez de fichiers existent.
Si aucun fichier ne convient, laisse la liste vide : la scène aura un fond aux couleurs de la marque.
Choisis un mouvement (none, zoom-in, zoom-out). Les images fixes gagnent à avoir un zoom.
Choisis une musique dans les fichiers de type music, ou null. Volume de la musique entre -24 et -14 dB.
Choisis le rythme : calm, normal ou fast.
N'utilise que des ids présents dans la liste.${correction}`;
    const directions = await this.ask(directionsSchema, prompt, "medium");
    const known = new Set(req.assets.map((a) => a.id));
    return {
      ...directions,
      musicAssetId:
        directions.musicAssetId && known.has(directions.musicAssetId) ? directions.musicAssetId : null,
      scenes: directions.scenes.map((s) => ({ ...s, assetIds: s.assetIds.filter((id) => known.has(id)) })),
    };
  }

  async reviewFrames(req: {
    script: Script;
    frames: { sceneId: string; jpeg: Buffer; spokenText: string }[];
  }): Promise<ReviewIssue[]> {
    const content: Content[] = [
      {
        type: "text",
        text: `Voici une image extraite au milieu de chaque plan d'une vidéo verticale, avec ce qui est dit pendant ce plan.
Signale uniquement ce qui semble vraiment faux : visage coupé, personnage incohérent d'un plan à l'autre, texte mal orthographié, plan sans rapport avec ce qui est dit, image illisible.
Sévérité "fail" seulement pour une faute d'orthographe visible ou une image clairement cassée. Sinon "warn".
Si tout va bien, renvoie une liste vide.`,
      },
    ];
    for (const f of req.frames) {
      content.push({ type: "text", text: `Plan ${f.sceneId} : « ${f.spokenText} »` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") },
      });
    }
    const result = await this.ask(reviewSchema, content, "low", 8000);
    return result.issues;
  }

  async proposeCaption(req: { script: Script; platforms: string[]; previous?: string }): Promise<Caption> {
    const prompt = `Écris la légende de publication de cette vidéo pour ${req.platforms.join(", ") || "les réseaux"}.
Script : ${req.script.scenes.map((s) => s.text).join(" ")}
${req.previous ? `Propose autre chose que : """${req.previous}"""` : ""}
Deux phrases au plus, qui donnent envie de regarder sans dévoiler la fin. Ajoute 3 à 5 hashtags pertinents avec le #.`;
    return this.ask(captionSchema, prompt, "low", 4000);
  }

  async describeImage(req: { jpeg: Buffer; name: string; kind: string }): Promise<string | null> {
    const result = await this.ask(
      assetDescriptionSchema,
      [
        {
          type: "text",
          text: `Décris en une phrase ce que montre ce fichier (${req.kind}, « ${req.name} »), pour qu'un monteur sache quand l'utiliser.`,
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: req.jpeg.toString("base64") },
        },
      ],
      "low",
      2000,
    );
    return result.description;
  }
}
