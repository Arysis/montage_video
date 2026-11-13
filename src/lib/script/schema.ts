import { z } from "zod";

/**
 * Le script détaillé de la vidéo. Il est écrit par l'IA en un seul appel, relu et validé par
 * le créateur, puis il pilote tout : le prompteur (texte dit) et le montage (fonds, effets,
 * transitions, personnage, sous-titres). Le montage n'a donc plus besoin de rappeler l'IA.
 */

/** Fonds animés générés par le moteur de rendu (aucun appel à l'IA, aucun fichier requis). */
export const BACKGROUND_STYLES = ["aurore", "nuit", "particules", "degrade"] as const;
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];
export const BACKGROUND_LABELS: Record<BackgroundStyle, string> = {
  aurore: "Aurore (couleurs de ta marque qui ondulent)",
  nuit: "Nuit (fond sombre avec une lueur)",
  particules: "Particules (points lumineux qui bougent)",
  degrade: "Dégradé (couleurs vives qui glissent)",
};

/** Effets de caméra appliqués aux plans de la scène. */
export const EFFECTS = ["zoom-in", "zoom-out", "pan", "punch", "shake"] as const;
export type Effect = (typeof EFFECTS)[number];
export const EFFECT_LABELS: Record<Effect, string> = {
  "zoom-in": "Zoom avant lent",
  "zoom-out": "Zoom arrière lent",
  pan: "Panoramique",
  punch: "Zoom choc sur les mots forts",
  shake: "Secousse à l'entrée",
};

/** Transition vers la scène suivante. */
export const TRANSITIONS = ["cut", "fade", "slide", "zoom", "flash", "wipe", "blur"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<Transition, string> = {
  cut: "Coupe franche",
  fade: "Fondu",
  slide: "Glissement",
  zoom: "Zoom",
  flash: "Flash blanc",
  wipe: "Volet",
  blur: "Flou",
};

/** Ambiance de la musique trouvée automatiquement quand le créateur n'en fournit pas. */
export const MUSIC_MOODS = ["upbeat", "chill", "epic", "emotional", "corporate", "funny"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
export const MUSIC_MOOD_LABELS: Record<MusicMood, string> = {
  upbeat: "Entraînante",
  chill: "Calme et douce",
  epic: "Épique",
  emotional: "Émouvante",
  corporate: "Pro et positive",
  funny: "Légère et drôle",
};

/** Structures de vidéo courte que l'IA choisit selon l'idée (ou que le créateur impose). */
export const STRUCTURES = ["auto", "probleme", "liste", "histoire", "avant-apres", "mythe", "tuto"] as const;
export type Structure = (typeof STRUCTURES)[number];
export const STRUCTURE_LABELS: Record<Structure, string> = {
  auto: "L'IA choisit",
  probleme: "Problème → solution",
  liste: "Liste (3 astuces…)",
  histoire: "Histoire vécue",
  "avant-apres": "Avant / après",
  mythe: "Idée reçue démontée",
  tuto: "Tuto pas à pas",
};

export const TONES = ["auto", "direct", "drole", "inspirant", "expert", "calme"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = {
  auto: "L'IA choisit",
  direct: "Direct et percutant",
  drole: "Drôle",
  inspirant: "Inspirant",
  expert: "Expert et précis",
  calme: "Posé et bienveillant",
};

export const PACES = ["calm", "normal", "fast"] as const;
export const PACE_LABELS: Record<(typeof PACES)[number], string> = {
  calm: "Posé",
  normal: "Normal",
  fast: "Rapide",
};

export const characterSlotSchema = z.object({
  assetId: z.string().min(1),
  /** Vrai si le personnage dit le texte de la scène (bouche animée). */
  talking: z.boolean(),
});
export type CharacterSlot = z.infer<typeof characterSlotSchema>;

export const sceneScriptSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  visualIntent: z.string().default("Plan qui illustre la phrase"),
  onScreenText: z.string().max(80).nullable().default(null),
  /** Fichiers du créateur à montrer, dans l'ordre. Vide : fond généré. */
  visuals: z.array(z.string()).max(4).default([]),
  /** Fond animé utilisé quand il n'y a pas de fichier, ou derrière un personnage. */
  background: z.enum(BACKGROUND_STYLES).default("aurore"),
  effects: z.array(z.enum(EFFECTS)).max(3).default(["zoom-in"]),
  transition: z.enum(TRANSITIONS).default("cut"),
  character: characterSlotSchema.nullable().default(null),
  /** Mots-clés pour chercher une vidéo ou une photo libre de droits si la scène n'a pas de fichier. */
  search: z.string().max(80).nullable().default(null),
  /** Mots forts : zoom choc au moment où ils sont dits, mis en avant dans les sous-titres. */
  emphasis: z.array(z.string()).max(4).default([]),
  /**
   * Sans fichier : « stock » cherche une vraie vidéo ou photo libre de droits, « ai » génère une
   * image (idée abstraite, métaphore, chose introuvable en banque).
   */
  art: z.enum(["stock", "ai"]).default("stock"),
});

export const scriptSchema = z.object({
  title: z.string().min(1).max(80),
  scenes: z.array(sceneScriptSchema).min(1).max(12),
  caption: z.string().max(2200).default(""),
  hashtags: z.array(z.string()).max(10).default([]),
  pace: z.enum(PACES).default("normal"),
  musicAssetId: z.string().nullable().default(null),
  musicVolumeDb: z.number().min(-40).max(-6).default(-20),
  /** Sans fichier musique : ambiance de la musique libre à trouver (null : pas de musique). */
  musicMood: z.enum(MUSIC_MOODS).nullable().default(null),
  /** Bruitages discrets sur les transitions et les zooms chocs. */
  soundEffects: z.boolean().default(true),
  /** Structure retenue par l'IA (affichée au créateur). */
  structure: z.enum(STRUCTURES).nullable().default(null),
  /** Ton demandé par le créateur (gardé pour réécrire le script dans le même esprit). */
  tone: z.enum(TONES).nullable().default(null),
  subtitles: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** Date de validation par le créateur (ISO), null tant que le script n'est pas validé. */
  validatedAt: z.string().nullable().default(null),
});

export type SceneScript = z.output<typeof sceneScriptSchema>;
export type Script = z.output<typeof scriptSchema>;
export type ScriptInput = z.input<typeof scriptSchema>;

/** Remplit les champs absents (scripts écrits avant le script détaillé). */
export function normalizeScript(raw: ScriptInput | Script): Script {
  return scriptSchema.parse(raw);
}

/** Découpe le script en lignes pour le prompteur (une ligne par phrase). */
export function scriptToLines(script: ScriptInput): { sceneId: string; text: string }[] {
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
export function scriptFromEditorText(previous: ScriptInput, text: string): Script {
  const prev = normalizeScript(previous);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const scenes = paragraphs.map((p, i) => ({
    ...(prev.scenes[i] ?? sceneScriptSchema.parse({ id: "x", text: p })),
    id: `s${i + 1}`,
    text: p,
  }));
  return { ...prev, scenes: scenes.length ? scenes : prev.scenes };
}

/** Garde uniquement les fichiers connus, et renumérote les scènes s1, s2… */
export function sanitizeScript(script: Script, knownAssetIds: Set<string>): Script {
  const known = (id: string | null | undefined) => (id && knownAssetIds.has(id) ? id : null);
  return {
    ...script,
    musicAssetId: known(script.musicAssetId),
    scenes: script.scenes.map((s, i) => {
      const characterId = known(s.character?.assetId);
      return {
        ...s,
        id: `s${i + 1}`,
        visuals: [...new Set(s.visuals.filter((id) => knownAssetIds.has(id)))],
        character: characterId ? { assetId: characterId, talking: !!s.character?.talking } : null,
        effects: [...new Set(s.effects)],
        emphasis: s.emphasis.map((w) => w.trim()).filter(Boolean),
      };
    }),
  };
}

/**
 * Garantit un montage varié sans rappeler l'IA : pas deux scènes de suite avec les mêmes effets,
 * le même fond ou la même transition marquée, et une accroche qui frappe (zoom choc ou secousse).
 */
export function diversifyScript(script: Script): Script {
  const scenes = script.scenes.map((s) => ({ ...s, effects: [...s.effects] }));
  scenes.forEach((s, i) => {
    const prev = scenes[i - 1];
    if (i === 0 && !s.effects.some((e) => e === "punch" || e === "shake")) {
      s.effects = [...s.effects.slice(0, 2), s.emphasis.length ? "punch" : "shake"];
    }
    if (!prev) return;
    if (s.effects.join() === prev.effects.join()) {
      const alt = EFFECTS.find((e) => !prev.effects.includes(e) && e !== "shake") ?? "pan";
      s.effects = [alt, ...s.effects.filter((e) => e === "punch")].slice(0, 3);
    }
    if (s.background === prev.background && !s.visuals.length && !prev.visuals.length) {
      s.background =
        BACKGROUND_STYLES[(BACKGROUND_STYLES.indexOf(s.background) + 1) % BACKGROUND_STYLES.length]!;
    }
    if (s.transition !== "cut" && s.transition === prev.transition) s.transition = "cut";
  });
  return { ...script, scenes };
}
