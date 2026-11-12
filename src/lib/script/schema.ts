import { z } from "zod";

export const sceneScriptSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).describe("Ce que la personne dit à voix haute dans cette scène"),
  visualIntent: z.string().min(1).describe("Ce qu'on voit à l'écran pendant cette scène"),
  onScreenText: z.string().nullable().describe("Texte court affiché à l'écran, ou null"),
});

export const scriptSchema = z.object({
  title: z.string().min(1).max(80),
  scenes: z.array(sceneScriptSchema).min(1).max(12),
  caption: z.string().max(2200),
  hashtags: z.array(z.string()).max(10),
});

export type SceneScript = z.infer<typeof sceneScriptSchema>;
export type Script = z.infer<typeof scriptSchema>;

/** Découpe le script en lignes pour le prompteur (une ligne par phrase). */
export function scriptToLines(script: Script): { sceneId: string; text: string }[] {
  const lines: { sceneId: string; text: string }[] = [];
  for (const scene of script.scenes) {
    const sentences = scene.text
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) lines.push({ sceneId: scene.id, text: sentence });
  }
  return lines;
}

/** Durée de lecture estimée (environ 2,6 mots par seconde en français parlé). */
export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 2.6) * 10) / 10);
}

/** Convertit le texte saisi dans l'éditeur (une scène par paragraphe) en scènes. */
export function scriptFromEditorText(previous: Script, text: string): Script {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const scenes = paragraphs.map((p, i) => {
    const prev = previous.scenes[i];
    return {
      id: `s${i + 1}`,
      text: p,
      visualIntent: prev?.visualIntent ?? "Plan qui illustre la phrase",
      onScreenText: prev?.onScreenText ?? null,
    };
  });
  return { ...previous, scenes: scenes.length ? scenes : previous.scenes };
}
