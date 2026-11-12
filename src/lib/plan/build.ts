import { buildCharacterRigs, type TalkingCharacter } from "@/lib/character/plan";
import type { BrandColor } from "@/lib/db/schema";
import type { Script } from "@/lib/script/schema";
import type { WordTiming } from "@/lib/stt/types";
import type { Effect, Transition } from "@/lib/script/schema";
import { normalizeToken, sceneSpans, tokenize } from "./align";
import { type Directions, maxShotSeconds } from "./directions";
import { type EditPlan, FORMATS, type Motion, type PlanScene, type VideoFormat } from "./schema";

export type PlanAsset = {
  id: string;
  kind: string;
  durationSec: number | null;
  width?: number | null;
  height?: number | null;
};

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
  /** Personnage fourni pour la vidéo : il apparaît et parle (bouche animée s'il a plusieurs images). */
  characters?: TalkingCharacter[];
  /** Enveloppe de la voix (voir voiceEnvelope), pour animer la bouche. */
  voiceEnvelope?: Float32Array | null;
};

export const DEFAULT_BRAND_COLORS = {
  primary: "#FF5A36",
  background: "#0E0F11",
  text: "#F2EFE9",
  accent: "#3DDC97",
};

export function brandPalette(colors: BrandColor[]) {
  const find = (...names: string[]) =>
    colors.find((c) => names.some((n) => c.name.toLowerCase() === n.toLowerCase()))?.hex;
  return {
    primary: find("Principale", "primary") ?? colors[0]?.hex ?? DEFAULT_BRAND_COLORS.primary,
    background: find("Fond", "background") ?? DEFAULT_BRAND_COLORS.background,
    text: find("Texte", "text") ?? DEFAULT_BRAND_COLORS.text,
    accent:
      find("Accent", "Secondaire", "secondary") ??
      colors.find(
        (c) =>
          !["principale", "primary", "fond", "background", "texte", "text"].includes(c.name.toLowerCase()),
      )?.hex ??
      DEFAULT_BRAND_COLORS.accent,
  };
}

export function subtitleSize(format: VideoFormat): number {
  return format === "9:16" ? 64 : format === "1:1" ? 56 : 52;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Transition du script vers la transition FFmpeg (xfade) et sa durée. */
export function transitionFor(t: Transition, format: VideoFormat): PlanScene["transition"] {
  switch (t) {
    case "fade":
      return { type: "fade", duration: 0.35 };
    case "slide":
      return { type: format === "16:9" ? "slideleft" : "slideup", duration: 0.3 };
    case "zoom":
      return { type: "zoomin", duration: 0.35 };
    case "flash":
      return { type: "fadewhite", duration: 0.3 };
    case "wipe":
      return { type: "wipeleft", duration: 0.3 };
    case "blur":
      return { type: "hblur", duration: 0.35 };
    default:
      return { type: "cut", duration: 0 };
  }
}

/** Mouvements de caméra possibles pour une scène, d'après ses effets. */
function motionCycle(effects: Effect[], isVideo: boolean): Motion[] {
  const cycle: Motion[] = [];
  if (effects.includes("zoom-in")) cycle.push("zoom-in");
  if (effects.includes("zoom-out")) cycle.push("zoom-out");
  if (effects.includes("pan")) cycle.push("pan-left", "pan-right");
  if (!cycle.length) cycle.push(isVideo ? "none" : "zoom-in");
  // Un seul zoom : on alterne avant et arrière pour que deux plans de suite ne se ressemblent pas.
  if (cycle.length === 1 && cycle[0] === "zoom-in") cycle.push("zoom-out");
  if (cycle.length === 1 && cycle[0] === "zoom-out") cycle.push("zoom-in");
  return cycle;
}

/** Le fichier n'a pas le même cadre que la vidéo (photo paysage dans une vidéo verticale…). */
function needsContain(asset: PlanAsset, width: number, height: number): boolean {
  if (!asset.width || !asset.height) return false;
  const ratio = asset.width / asset.height / (width / height);
  return ratio > 1.35 || ratio < 0.74;
}

/**
 * Construit le plan de montage à partir du script détaillé, de la prise de voix transcrite
 * et des choix de montage. Les coupes sont calées sur la voix : chaque scène commence au
 * premier mot qu'elle contient.
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
  // Les images d'un personnage qui parle ne servent pas de fond : il est incrusté par-dessus.
  const characterImages = new Set((input.characters ?? []).flatMap((c) => c.group.ids));
  const speaker = input.characters?.[0]?.group.mainId ?? null;
  const mainOf = (id: string) => input.characters?.find((c) => c.group.ids.includes(id))?.group.mainId ?? id;
  const scriptHasCharacter = directions.scenes.some(
    (d) => d.character || d.assetIds.some((id) => assetById.get(id)?.kind === "character"),
  );
  const palette = brandPalette(brand.colors);
  const shotMax = maxShotSeconds(directions.pace);
  const scenes: PlanScene[] = [];

  spans.forEach((span, k) => {
    const start = k === 0 ? 0 : round(words[span.firstWord]!.start - trimStart);
    const next = spans[k + 1];
    const end = next ? round(words[next.firstWord]!.start - trimStart) : timelineEnd;
    if (end - start < 0.2) return;
    const direction = directions.scenes.find((d) => d.sceneId === span.sceneId);
    const effects = direction?.effects ?? [];
    let character = direction?.character ?? null;
    if (character && assetById.get(character.assetId)?.kind !== "character") character = null;
    const chosen = (direction?.assetIds ?? [])
      .map((id) => assetById.get(id))
      .filter((a): a is PlanAsset => !!a);
    // Un personnage choisi comme visuel est incrusté sur un fond généré plutôt que recadré.
    const firstCharacter = chosen.find((a) => a.kind === "character");
    if (!character && firstCharacter) character = { assetId: firstCharacter.id, talking: true };
    // Toutes les images d'un personnage animé (ses poses) renvoient à son image principale.
    if (character) character = { ...character, assetId: mainOf(character.assetId) };
    // Sans personnage dans le script, le personnage fourni pour la vidéo parle partout.
    if (!scriptHasCharacter && speaker) character = { assetId: speaker, talking: true };
    const visualAssets = chosen.filter(
      (a) => (a.kind === "video" || a.kind === "image") && !characterImages.has(a.id),
    );
    const sceneWords = words.slice(span.firstWord, span.lastWord + 1);
    const emphasis = new Set((direction?.emphasis ?? []).flatMap((w) => tokenize(w)));
    const generated: PlanScene["visual"] = {
      type: "generated",
      style: direction?.background ?? "aurore",
      colors: [palette.primary, palette.background, palette.accent],
      seed: k + 1,
    };

    // Découper en plans courts quand la scène dépasse la durée maximale d'un plan.
    const duration = end - start;
    const shots = visualAssets.length ? Math.min(8, Math.max(1, Math.ceil(duration / shotMax))) : 1;
    const shotLen = duration / shots;
    const sceneShots: PlanScene[] = [];
    for (let s = 0; s < shots; s++) {
      const shotStart = round(start + s * shotLen);
      const shotEnd = s === shots - 1 ? end : round(start + (s + 1) * shotLen);
      const asset = visualAssets.length ? visualAssets[s % visualAssets.length] : undefined;
      const inShot = sceneWords.filter(
        (w) => w.start - trimStart >= shotStart - 0.01 && w.start - trimStart < shotEnd,
      );
      let sourceStart = 0;
      if (asset?.kind === "video" && asset.durationSec) {
        const needed = shotEnd - shotStart;
        sourceStart =
          asset.durationSec > needed ? round(Math.min(s * needed, asset.durationSec - needed)) : 0;
      }
      const cycle = motionCycle(effects, asset?.kind === "video");
      const punches = effects.includes("punch")
        ? inShot
            .filter((w) => emphasis.has(normalizeToken(w.word)))
            .map((w) => round(Math.max(0, w.start - trimStart - shotStart)))
            .slice(0, 3)
        : [];
      sceneShots.push({
        id: shots > 1 ? `${span.sceneId}.${s + 1}` : span.sceneId,
        start: shotStart,
        end: shotEnd,
        spokenText: inShot.map((w) => w.word).join(" "),
        visual: asset
          ? {
              type: "asset",
              assetId: asset.id,
              sourceStart,
              motion: cycle[(k + s) % cycle.length]!,
              fit: needsContain(asset, width, height) ? "contain" : "cover",
            }
          : generated,
        overlayText: s === 0 ? (direction?.overlayText ?? null) : null,
        transition: { type: "cut", duration: 0 },
        punches,
        shake: s === 0 && effects.includes("shake"),
        character,
      });
    }
    // Sans mot fort trouvé, le zoom choc tombe au début de la scène.
    if (effects.includes("punch") && sceneShots[0] && sceneShots.every((x) => !x.punches.length)) {
      sceneShots[0].punches = [0];
    }
    const last = sceneShots[sceneShots.length - 1];
    if (last && next) last.transition = transitionFor(direction?.transition ?? "cut", format);
    scenes.push(...sceneShots);
  });

  // Une transition ne doit pas manger plus de 40 % de l'un des deux plans.
  scenes.forEach((s, i) => {
    const after = scenes[i + 1];
    if (s.transition.type === "cut") return;
    if (!after) {
      s.transition = { type: "cut", duration: 0 };
      return;
    }
    const max = Math.min(s.transition.duration, (s.end - s.start) * 0.4, (after.end - after.start) * 0.4);
    s.transition = max < 0.12 ? { type: "cut", duration: 0 } : { ...s.transition, duration: round(max) };
  });

  const musicAsset = directions.musicAssetId ? assetById.get(directions.musicAssetId) : undefined;
  const logoAsset = brand.logoAssetId ? assetById.get(brand.logoAssetId) : undefined;

  const characterRigs = input.characters?.length
    ? buildCharacterRigs({
        format,
        width,
        height,
        durationSec: timelineEnd,
        scenes,
        characters: input.characters,
        envelope: input.voiceEnvelope ?? null,
        words,
        trimStart,
      })
    : undefined;

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
      enabled: directions.subtitles,
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
      emphasis: [...new Set(directions.scenes.flatMap((d) => d.emphasis))],
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
    ...(characterRigs && Object.keys(characterRigs).length ? { characterRigs } : {}),
  };
}
