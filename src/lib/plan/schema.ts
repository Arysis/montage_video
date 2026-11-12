import { z } from "zod";
import { BACKGROUND_STYLES } from "@/lib/script/schema";

/**
 * Le plan de montage : un JSON qui décrit la vidéo scène par scène.
 * L'IA l'écrit, le moteur de rendu (FFmpeg) l'exécute. On ne manipule jamais de pixels directement.
 */

export const FORMATS = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
} as const;

export type VideoFormat = keyof typeof FORMATS;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur hexadécimale attendue (#RRGGBB)");

export const MOTIONS = ["none", "zoom-in", "zoom-out", "pan-left", "pan-right"] as const;
export type Motion = (typeof MOTIONS)[number];

export const visualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("asset"),
    assetId: z.string().uuid(),
    /** Pour une vidéo : à partir de quelle seconde du rush on prend le plan. */
    sourceStart: z.number().min(0).default(0),
    motion: z.enum(MOTIONS).default("none"),
    /** cover : remplit l'écran ; contain : en entier, sur un fond flou du même fichier. */
    fit: z.enum(["cover", "contain"]).default("cover"),
  }),
  z.object({
    type: z.literal("color"),
    color: hex,
  }),
  z.object({
    /** Fond animé calculé par FFmpeg aux couleurs de la marque. */
    type: z.literal("generated"),
    style: z.enum(BACKGROUND_STYLES),
    colors: z.array(hex).min(2).max(4),
    seed: z.number().int().min(0),
  }),
]);

export const TRANSITION_TYPES = [
  "cut",
  "fade",
  "slideleft",
  "slideup",
  "zoomin",
  "fadewhite",
  "wipeleft",
  "hblur",
] as const;

export const planSceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  end: z.number().positive(),
  spokenText: z.string(),
  visual: visualSchema,
  overlayText: z.string().max(80).nullable().default(null),
  /** Transition vers le plan suivant (chevauche le début du plan suivant). */
  transition: z
    .object({ type: z.enum(TRANSITION_TYPES), duration: z.number().min(0).max(1) })
    .default({ type: "cut", duration: 0 }),
  /** Zooms chocs : secondes depuis le début du plan. */
  punches: z.array(z.number().min(0)).max(6).default([]),
  shake: z.boolean().default(false),
  /** Personnage incrusté par-dessus le fond (animé par le module personnage s'il parle). */
  character: z.object({ assetId: z.string().uuid(), talking: z.boolean() }).nullable().default(null),
});

export const wordSchema = z.object({
  word: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
});

export const editPlanSchema = z
  .object({
    version: z.literal(1),
    format: z.enum(["9:16", "1:1", "16:9"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.literal(30),
    durationSec: z.number().positive().max(600),
    voice: z
      .object({
        takeId: z.string().uuid(),
        trimStart: z.number().min(0),
      })
      .nullable(),
    scenes: z.array(planSceneSchema).min(1),
    subtitles: z.object({
      enabled: z.boolean(),
      style: z.enum(["boxed", "outline", "word"]),
      position: z.enum(["bottom", "center"]),
      font: z.string().min(1),
      sizePx: z.number().int().min(24).max(160),
      color: hex,
      highlightColor: hex,
      boxColor: hex,
      words: z.array(wordSchema),
      /** Mots forts choisis dans le script, à mettre en avant. */
      emphasis: z.array(z.string()).default([]),
    }),
    music: z
      .object({
        assetId: z.string().uuid(),
        volumeDb: z.number().min(-40).max(0),
        duckUnderVoice: z.boolean(),
      })
      .nullable(),
    logo: z
      .object({
        assetId: z.string().uuid(),
        position: z.enum(["top-left", "top-right"]),
        showFrom: z.number().min(0),
        showUntil: z.number().positive(),
        widthRatio: z.number().min(0.05).max(0.4),
      })
      .nullable(),
    brand: z.object({
      titleFont: z.string().min(1),
      bodyFont: z.string().min(1),
      primary: hex,
      background: hex,
      text: hex,
    }),
    outro: z
      .object({
        durationSec: z.number().min(1).max(5),
        text: z.string().max(80),
      })
      .nullable(),
    watermark: z.boolean().default(false),
  })
  .superRefine((plan, ctx) => {
    plan.scenes.forEach((s, i) => {
      if (s.end <= s.start) {
        ctx.addIssue({ code: "custom", path: ["scenes", i], message: `Scène ${s.id} : fin avant début` });
      }
    });
  });

export type EditPlan = z.infer<typeof editPlanSchema>;
export type PlanScene = z.infer<typeof planSceneSchema>;
export type PlanVisual = z.infer<typeof visualSchema>;

/** Liste des assets référencés par un plan (pour vérifier qu'ils existent et leurs droits). */
export function referencedAssetIds(plan: EditPlan): string[] {
  const ids = new Set<string>();
  for (const s of plan.scenes) {
    if (s.visual.type === "asset") ids.add(s.visual.assetId);
    if (s.character) ids.add(s.character.assetId);
  }
  if (plan.music) ids.add(plan.music.assetId);
  if (plan.logo) ids.add(plan.logo.assetId);
  return [...ids];
}

export function totalDuration(plan: EditPlan): number {
  const last = plan.scenes.reduce((m, s) => Math.max(m, s.end), 0);
  return last + (plan.outro?.durationSec ?? 0);
}
