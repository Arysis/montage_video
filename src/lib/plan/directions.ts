import { z } from "zod";

/**
 * Ce que l'IA décide pour le montage : quels visuels pour chaque scène, quel mouvement,
 * quel texte à l'écran, quelle musique. Les horaires, eux, sont calculés à partir de la voix.
 */
export const sceneDirectionSchema = z.object({
  sceneId: z.string(),
  /** Assets à utiliser dans l'ordre (plusieurs si la scène est longue). Vide : fond de couleur. */
  assetIds: z.array(z.string()).max(4),
  motion: z.enum(["none", "zoom-in", "zoom-out"]),
  overlayText: z.string().max(80).nullable(),
});

export const directionsSchema = z.object({
  scenes: z.array(sceneDirectionSchema),
  musicAssetId: z.string().nullable(),
  musicVolumeDb: z.number().min(-40).max(-6),
  pace: z.enum(["calm", "normal", "fast"]),
});

export type Directions = z.infer<typeof directionsSchema>;
export type SceneDirection = z.infer<typeof sceneDirectionSchema>;

/** Durée maximale d'un plan sans changement d'image, selon le rythme. */
export function maxShotSeconds(pace: Directions["pace"]): number {
  return pace === "fast" ? 2.5 : pace === "calm" ? 5 : 4;
}
