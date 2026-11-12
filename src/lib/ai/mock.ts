import type { Directions } from "@/lib/plan/directions";
import type { Script } from "@/lib/script/schema";
import type { AiProvider, Caption, DirectionRequest, ReviewIssue, ScriptRequest } from "./types";

/**
 * Fournisseur IA déterministe, sans appel réseau.
 * Sert aux tests automatisés et au développement hors ligne. Jamais activé en production.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async generateScript(req: ScriptRequest): Promise<Script> {
    const topic =
      req.idea
        .split(/[.!?\n]/)[0]!
        .trim()
        .slice(0, 60) || "ton sujet";
    const sentences = [
      `Tu veux parler de ${topic} ?`,
      "Voici ce qui change tout dès les premières secondes.",
      "Commence par montrer le résultat.",
      "Explique ensuite comment tu y es arrivé.",
      "Abonne-toi pour la suite.",
    ];
    return {
      title: topic,
      scenes: sentences.map((text, i) => ({
        id: `s${i + 1}`,
        text,
        visualIntent: i === 0 ? "Plan d'accroche" : "Plan qui illustre la phrase",
        onScreenText: i === 0 ? topic.slice(0, 40) : null,
      })),
      caption: `${topic}. Regarde jusqu'au bout.`,
      hashtags: ["#conseils", "#createur", "#video"],
    };
  }

  async directMontage(req: DirectionRequest): Promise<Directions> {
    const visuals = req.assets.filter((a) => ["video", "image", "character"].includes(a.kind));
    const music = req.assets.find((a) => a.kind === "music");
    let cursor = 0;
    return {
      pace: "normal",
      musicAssetId: music?.id ?? null,
      musicVolumeDb: -20,
      scenes: req.script.scenes.map((s, i) => {
        const keep =
          req.sceneId && req.sceneId !== s.id
            ? req.previous?.scenes.find((p) => p.sceneId === s.id)
            : undefined;
        if (keep) return keep;
        const ids = visuals.length
          ? [visuals[cursor++ % visuals.length]!.id, visuals[cursor++ % visuals.length]!.id]
          : [];
        return {
          sceneId: s.id,
          assetIds: [...new Set(ids)],
          motion: i % 2 === 0 ? "zoom-in" : "zoom-out",
          overlayText: s.onScreenText,
        };
      }),
    };
  }

  async reviewFrames(): Promise<ReviewIssue[] | null> {
    return null;
  }

  async proposeCaption(req: { script: Script; previous?: string }): Promise<Caption> {
    const base = req.script.caption || req.script.title;
    return {
      caption: req.previous ? `${req.script.title}. La suite dans la vidéo.` : base,
      hashtags: req.script.hashtags.length ? req.script.hashtags : ["#video"],
    };
  }

  async describeImage(): Promise<string | null> {
    return null;
  }
}
