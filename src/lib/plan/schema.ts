import { z } from "zod";

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

export const visualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("asset"),
    assetId: z.string().uuid(),
    /** Pour une vidéo : à partir de quelle seconde du rush on prend le plan. */
    sourceStart: z.number().min(0).default(0),
    motion: z.enum(["none", "zoom-in", "zoom-out"]).default("none"),
  }),
  z.object({
    type: z.literal("color"),
    color: hex,
  }),
]);

export const planSceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  end: z.number().positive(),
  spokenText: z.string(),
  visual: visualSchema,
  overlayText: z.string().max(80).nullable().default(null),
  /** Personnage à l'écran dans cette scène (talking : il dit le texte de la scène). */
  character: z
    .object({ assetId: z.string().uuid(), talking: z.boolean() })
    .nullable()
    .default(null)
    .optional(),
});

const poseIdSchema = z.string().uuid().nullable();

/** Animation d'un personnage : ses images, sa place et sa bouche image par image (30 i/s). */
export const characterRigSchema = z.object({
  poses: z.object({ closed: z.string().uuid(), half: poseIdSchema, open: poseIdSchema, blink: poseIdSchema }),
  box: z.object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  mouth: z.string().regex(/^[chob]*$/),
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
    /** Personnages animés, par id de leur image principale. */
    characterRigs: z.record(z.string(), characterRigSchema).optional(),
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
  for (const s of plan.scenes) if (s.visual.type === "asset") ids.add(s.visual.assetId);
  if (plan.music) ids.add(plan.music.assetId);
  if (plan.logo) ids.add(plan.logo.assetId);
  for (const rig of Object.values(plan.characterRigs ?? {})) {
    for (const id of Object.values(rig.poses)) if (id) ids.add(id);
  }
  return [...ids];
}

export function totalDuration(plan: EditPlan): number {
  const last = plan.scenes.reduce((m, s) => Math.max(m, s.end), 0);
  return last + (plan.outro?.durationSec ?? 0);
}
