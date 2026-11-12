import { BACKGROUND_STYLES, normalizeScript, type Script } from "@/lib/script/schema";
import type { AiProvider, Caption, ReviewIssue, ReviseRequest, ScriptRequest } from "./types";

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
    const visuals = req.assets.filter((a) => a.kind === "video" || a.kind === "image");
    const character = req.assets.find((a) => a.kind === "character");
    const music = req.assets.find((a) => a.kind === "music");
    const transitions = ["flash", "cut", "slide", "cut", "cut"] as const;
    const backgrounds = ["aurore", "particules", "nuit", "degrade", "aurore"] as const;
    let cursor = 0;
    return normalizeScript({
      title: topic,
      pace: "fast",
      musicAssetId: music?.id ?? null,
      scenes: sentences.map((text, i) => ({
        id: `s${i + 1}`,
        text,
        visualIntent: i === 0 ? "Plan d'accroche" : "Plan qui illustre la phrase",
        onScreenText: i === 0 ? topic.slice(0, 40) : null,
        // Une scène sur deux montre les fichiers, les autres un fond généré.
        visuals:
          visuals.length && i % 2 === 1
            ? [...new Set([visuals[cursor++ % visuals.length]!.id, visuals[cursor++ % visuals.length]!.id])]
            : [],
        background: backgrounds[i]!,
        effects: i === 0 ? ["punch", "shake"] : i % 2 ? ["zoom-in", "pan"] : ["zoom-out"],
        transition: transitions[i]!,
        character: character && i === 0 ? { assetId: character.id, talking: true } : null,
        emphasis: i === 0 ? [topic.split(" ")[0] ?? ""].filter(Boolean) : [],
      })),
      caption: `${topic}. Regarde jusqu'au bout.`,
      hashtags: ["#conseils", "#createur", "#video"],
    });
  }

  async reviseScript(req: ReviseRequest): Promise<Script> {
    const visuals = req.assets.filter((a) => a.kind === "video" || a.kind === "image");
    return {
      ...req.script,
      scenes: req.script.scenes.map((s, i) => {
        if (req.sceneId && req.sceneId !== s.id) return s;
        const other = visuals.find((v) => !s.visuals.includes(v.id));
        return {
          ...s,
          visuals: other ? [other.id] : [],
          background: BACKGROUND_STYLES[(BACKGROUND_STYLES.indexOf(s.background) + 1) % 4]!,
          effects: i % 2 ? ["zoom-out"] : ["zoom-in", "punch"],
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
