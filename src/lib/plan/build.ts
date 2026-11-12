import type { BrandColor } from "@/lib/db/schema";
import type { Script } from "@/lib/script/schema";
import type { WordTiming } from "@/lib/stt/types";
import { sceneSpans } from "./align";
import { type Directions, maxShotSeconds } from "./directions";
import { type EditPlan, FORMATS, type PlanScene, type VideoFormat } from "./schema";

export type PlanAsset = { id: string; kind: string; durationSec: number | null };

export type BrandInput = {
  colors: BrandColor[];
  titleFont: string;
  bodyFont: string;
  subtitleStyle: "boxed" | "outline" | "word";
  subtitlePosition: "bottom" | "center";
  logoAssetId: string | null;
};

export type BuildInput = {
  format: VideoFormat;
  script: Script;
  take: { id: string; durationSec: number; words: WordTiming[] };
  directions: Directions;
  assets: PlanAsset[];
  brand: BrandInput;
  watermark: boolean;
};

export const DEFAULT_BRAND_COLORS = { primary: "#FF5A36", background: "#0E0F11", text: "#F2EFE9" };

export function brandPalette(colors: BrandColor[]) {
  const find = (...names: string[]) =>
    colors.find((c) => names.some((n) => c.name.toLowerCase() === n.toLowerCase()))?.hex;
  return {
    primary: find("Principale", "primary") ?? colors[0]?.hex ?? DEFAULT_BRAND_COLORS.primary,
    background: find("Fond", "background") ?? DEFAULT_BRAND_COLORS.background,
    text: find("Texte", "text") ?? DEFAULT_BRAND_COLORS.text,
  };
}

export function subtitleSize(format: VideoFormat): number {
  return format === "9:16" ? 64 : format === "1:1" ? 56 : 52;
}

const round = (n: number) => Math.round(n * 100) / 100;

function alternate(motion: "none" | "zoom-in" | "zoom-out", shot: number): "none" | "zoom-in" | "zoom-out" {
  const cycle =
    motion === "zoom-out" ? (["zoom-out", "zoom-in"] as const) : (["zoom-in", "zoom-out"] as const);
  return cycle[shot % 2]!;
}

/**
 * Construit le plan de montage à partir du script, de la prise de voix transcrite et des choix de l'IA.
 * Les coupes sont calées sur la voix : chaque scène commence au premier mot qu'elle contient.
 */
export function buildPlan(input: BuildInput): EditPlan {
  const { format, script, take, directions, assets, brand } = input;
  const { width, height } = FORMATS[format];
  const words = take.words;
  if (!words.length) throw new Error("La prise de voix ne contient aucun mot reconnu.");

  const trimStart = Math.max(0, words[0]!.start - 0.2);
  const voiceEnd = Math.min(take.durationSec, words[words.length - 1]!.end + 0.4);
  const timelineEnd = round(voiceEnd - trimStart);

  const spans = sceneSpans(script.scenes, words);
  if (spans[0]) spans[0].firstWord = 0;

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const palette = brandPalette(brand.colors);
  const shotMax = maxShotSeconds(directions.pace);
  const scenes: PlanScene[] = [];

  spans.forEach((span, k) => {
    const start = k === 0 ? 0 : round(words[span.firstWord]!.start - trimStart);
    const next = spans[k + 1];
    const end = next ? round(words[next.firstWord]!.start - trimStart) : timelineEnd;
    if (end - start < 0.2) return;
    const direction = directions.scenes.find((d) => d.sceneId === span.sceneId);
    const visualAssets = (direction?.assetIds ?? []).filter((id) => {
      const a = assetById.get(id);
      return a && (a.kind === "video" || a.kind === "image" || a.kind === "character" || a.kind === "logo");
    });
    const sceneWords = words.slice(span.firstWord, span.lastWord + 1);

    // Découper en plans courts quand la scène dépasse la durée maximale d'un plan.
    const duration = end - start;
    // Avec un seul visuel, on alterne le cadrage (zoom avant, zoom arrière) pour garder du rythme.
    const shots = visualAssets.length ? Math.min(6, Math.max(1, Math.ceil(duration / shotMax))) : 1;
    const shotLen = duration / shots;
    for (let s = 0; s < shots; s++) {
      const shotStart = round(start + s * shotLen);
      const shotEnd = s === shots - 1 ? end : round(start + (s + 1) * shotLen);
      const assetId = visualAssets[s % Math.max(1, visualAssets.length)];
      const asset = assetId ? assetById.get(assetId) : undefined;
      const spoken = sceneWords
        .filter((w) => w.start - trimStart >= shotStart - 0.01 && w.start - trimStart < shotEnd)
        .map((w) => w.word)
        .join(" ");
      let sourceStart = 0;
      if (asset?.kind === "video" && asset.durationSec) {
        const needed = shotEnd - shotStart;
        sourceStart =
          asset.durationSec > needed ? round(Math.min(s * needed, asset.durationSec - needed)) : 0;
      }
      scenes.push({
        id: shots > 1 ? `${span.sceneId}.${s + 1}` : span.sceneId,
        start: shotStart,
        end: shotEnd,
        spokenText: spoken,
        visual: asset
          ? {
              type: "asset",
              assetId: asset.id,
              sourceStart,
              motion:
                s > 0 && visualAssets.length < shots && asset.kind !== "video"
                  ? alternate(direction?.motion ?? "none", s)
                  : (direction?.motion ?? "none"),
            }
          : { type: "color", color: palette.background },
        overlayText: s === 0 ? (direction?.overlayText ?? null) : null,
      });
    }
  });

  const musicAsset = directions.musicAssetId ? assetById.get(directions.musicAssetId) : undefined;
  const logoAsset = brand.logoAssetId ? assetById.get(brand.logoAssetId) : undefined;

  return {
    version: 1,
    format,
    width,
    height,
    fps: 30,
    durationSec: timelineEnd,
    voice: { takeId: take.id, trimStart: round(trimStart) },
    scenes,
    subtitles: {
      enabled: true,
      style: brand.subtitleStyle,
      position: brand.subtitlePosition,
      font: brand.bodyFont,
      sizePx: subtitleSize(format),
      color: palette.text,
      highlightColor: palette.primary,
      boxColor: palette.background,
      words: words
        .filter((w) => w.end > trimStart && w.start - trimStart < timelineEnd)
        .map((w) => ({
          word: w.word,
          start: round(Math.max(0, w.start - trimStart)),
          end: round(Math.min(timelineEnd, w.end - trimStart)),
        })),
    },
    music:
      musicAsset && musicAsset.kind === "music"
        ? { assetId: musicAsset.id, volumeDb: directions.musicVolumeDb, duckUnderVoice: true }
        : null,
    logo: logoAsset
      ? {
          assetId: logoAsset.id,
          position: "top-right",
          showFrom: 0,
          showUntil: timelineEnd,
          widthRatio: 0.16,
        }
      : null,
    brand: {
      titleFont: brand.titleFont,
      bodyFont: brand.bodyFont,
      primary: palette.primary,
      background: palette.background,
      text: palette.text,
    },
    outro: null,
    watermark: input.watermark,
  };
}
