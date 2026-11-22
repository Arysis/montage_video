import { buildPlan, type BrandInput } from "@/lib/plan/build";
import type { Directions, SceneDirection } from "@/lib/plan/directions";
import type { EditPlan } from "@/lib/plan/schema";
import { normalizeScript, type Script } from "@/lib/script/schema";
import type { WordTiming } from "@/lib/stt/types";

export const IDS = {
  "img-1": "11111111-1111-4111-8111-111111111111",
  "vid-1": "22222222-2222-4222-8222-222222222222",
  "logo-1": "33333333-3333-4333-8333-333333333333",
  "music-1": "44444444-4444-4444-8444-444444444444",
  "take-1": "55555555-5555-4555-8555-555555555555",
} as const;

export const script: Script = normalizeScript({
  title: "Trois erreurs",
  scenes: [
    {
      id: "s1",
      text: "Tu publies des vidéos et personne ne les regarde ?",
      visualIntent: "accroche",
      onScreenText: "3 erreurs",
    },
    {
      id: "s2",
      text: "Le problème vient souvent des trois premières secondes.",
      visualIntent: "problème",
      onScreenText: null,
    },
    {
      id: "s3",
      text: "Commence par ce que la personne va gagner.",
      visualIntent: "démo",
      onScreenText: null,
    },
    { id: "s4", text: "Abonne-toi pour la suite.", visualIntent: "appel", onScreenText: null },
  ],
  caption: "Trois erreurs à éviter.",
  hashtags: ["#conseils"],
});

/** Mots horodatés réguliers à partir d'un texte (0,4 s par mot, départ à 0,5 s). */
export function wordsFor(text: string, start = 0.5, step = 0.4): WordTiming[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({
      word,
      start: +(start + i * step).toFixed(2),
      end: +(start + i * step + step * 0.8).toFixed(2),
    }));
}

export const brand: BrandInput = {
  colors: [
    { name: "Principale", hex: "#FF5A36" },
    { name: "Fond", hex: "#0E0F11" },
    { name: "Texte", hex: "#F2EFE9" },
  ],
  titleFont: "Bricolage Grotesque",
  bodyFont: "IBM Plex Sans",
  subtitleStyle: "boxed",
  subtitlePosition: "bottom",
  logoAssetId: "33333333-3333-4333-8333-333333333333",
};

export const assets = [
  { id: "11111111-1111-4111-8111-111111111111", kind: "image", durationSec: null },
  { id: "22222222-2222-4222-8222-222222222222", kind: "video", durationSec: 20 },
  { id: "33333333-3333-4333-8333-333333333333", kind: "logo", durationSec: null },
  { id: "44444444-4444-4444-8444-444444444444", kind: "music", durationSec: 60 },
];

const scene = (sceneId: string, assetIds: string[], extra: Partial<SceneDirection> = {}): SceneDirection => ({
  sceneId,
  assetIds,
  background: "aurore",
  effects: ["zoom-in"],
  transition: "cut",
  overlayText: null,
  character: null,
  emphasis: [],
  ...extra,
});

export const directions: Directions = {
  pace: "normal",
  musicAssetId: "44444444-4444-4444-8444-444444444444",
  musicVolumeDb: -20,
  subtitles: true,
  soundEffects: true,
  scenes: [
    scene("s1", ["22222222-2222-4222-8222-222222222222"], {
      effects: [],
      overlayText: "3 erreurs",
      transition: "flash",
    }),
    scene("s2", ["11111111-1111-4111-8111-111111111111"]),
    scene("s3", ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], {
      effects: ["zoom-out"],
      transition: "fade",
    }),
    scene("s4", []),
  ],
};

export function samplePlan(overrides: Partial<Parameters<typeof buildPlan>[0]> = {}): EditPlan {
  const words = wordsFor(script.scenes.map((s) => s.text).join(" "));
  return buildPlan({
    format: "9:16",
    script,
    take: {
      id: "55555555-5555-4555-8555-555555555555",
      durationSec: words[words.length - 1]!.end + 1,
      words,
    },
    directions,
    assets,
    brand,
    watermark: false,
    ...overrides,
  });
}
