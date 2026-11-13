import type { BackgroundStyle, CharacterSlot, Effect, Script, Transition } from "@/lib/script/schema";

/**
 * Les choix de montage d'une scène : quels visuels, quel fond, quels effets, quelle transition.
 * Ils viennent directement du script détaillé validé par le créateur : le montage n'appelle
 * pas l'IA. Les horaires, eux, sont calculés à partir de la voix.
 */
export type SceneDirection = {
  sceneId: string;
  /** Fichiers à montrer, dans l'ordre (plusieurs plans si la scène est longue). Vide : fond généré. */
  assetIds: string[];
  background: BackgroundStyle;
  effects: Effect[];
  /** Transition vers la scène suivante. */
  transition: Transition;
  overlayText: string | null;
  character: CharacterSlot | null;
  emphasis: string[];
};

export type Directions = {
  scenes: SceneDirection[];
  musicAssetId: string | null;
  musicVolumeDb: number;
  pace: "calm" | "normal" | "fast";
  subtitles: boolean;
  soundEffects: boolean;
};

export function directionsFromScript(script: Script): Directions {
  return {
    pace: script.pace,
    musicAssetId: script.musicAssetId,
    musicVolumeDb: script.musicVolumeDb,
    subtitles: script.subtitles.enabled,
    soundEffects: script.soundEffects,
    scenes: script.scenes.map((s) => ({
      sceneId: s.id,
      assetIds: s.visuals,
      background: s.background,
      effects: s.effects,
      transition: s.transition,
      overlayText: s.onScreenText,
      character: s.character,
      emphasis: s.emphasis,
    })),
  };
}

/** Durée maximale d'un plan sans changement d'image, selon le rythme. */
export function maxShotSeconds(pace: Directions["pace"]): number {
  return pace === "fast" ? 2 : pace === "calm" ? 4.5 : 3;
}
