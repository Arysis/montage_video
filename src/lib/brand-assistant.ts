import { contrastRatio } from "@/lib/qc/rules";

/**
 * Assistant de direction artistique : à partir d'une ambiance (et, si le créateur en a une, d'une
 * couleur qu'il aime), propose trois Brand Kits complets et lisibles. Tout est calculé ici
 * (théorie des couleurs + contrastes WCAG) : aucun appel à l'IA, réponse immédiate et gratuite.
 */

export const MOODS = ["energique", "fun", "elegant", "tech", "naturel", "pro"] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_LABELS: Record<Mood, { label: string; help: string }> = {
  energique: { label: "Énergique", help: "Sport, motivation, business qui bouge" },
  fun: { label: "Fun", help: "Humour, lifestyle, jeunesse" },
  elegant: { label: "Élégant", help: "Mode, beauté, luxe, déco" },
  tech: { label: "Tech", help: "Outils, IA, gaming, tutos" },
  naturel: { label: "Naturel", help: "Bien-être, cuisine, voyage" },
  pro: { label: "Pro et sobre", help: "Conseil, finance, formation" },
};

export type BrandProposal = {
  name: string;
  /** Une phrase qui dit pourquoi ce choix. */
  why: string;
  colors: { name: string; hex: string }[];
  titleFont: string;
  bodyFont: string;
  subtitleStyle: "boxed" | "outline" | "word";
  subtitlePosition: "bottom" | "center";
};

type Preset = {
  /** Teintes de la couleur principale (une par proposition). */
  hues: [number, number, number];
  sat: number;
  /** Écart de teinte de la couleur secondaire (harmonie). */
  harmony: number;
  titleFonts: [string, string, string];
  bodyFont: string;
  subtitleStyle: BrandProposal["subtitleStyle"];
  /** Fond clair pour la 3e proposition (sinon les trois sont sombres). */
  lightThird: boolean;
  names: [string, string, string];
};

const PRESETS: Record<Mood, Preset> = {
  energique: {
    hues: [14, 350, 45],
    sat: 92,
    harmony: 160,
    titleFonts: ["Anton", "Bebas Neue", "Archivo Black"],
    bodyFont: "Poppins",
    subtitleStyle: "word",
    lightThird: false,
    names: ["Braise", "Sprint", "Éclair"],
  },
  fun: {
    hues: [330, 48, 190],
    sat: 90,
    harmony: 120,
    titleFonts: ["Luckiest Guy", "Archivo Black", "Luckiest Guy"],
    bodyFont: "Poppins",
    subtitleStyle: "word",
    lightThird: true,
    names: ["Bonbon", "Soleil", "Lagon"],
  },
  elegant: {
    hues: [38, 345, 160],
    sat: 45,
    harmony: 30,
    titleFonts: ["DM Serif Display", "Abril Fatface", "DM Serif Display"],
    bodyFont: "IBM Plex Sans",
    subtitleStyle: "outline",
    lightThird: true,
    names: ["Or noir", "Bordeaux", "Crème"],
  },
  tech: {
    hues: [222, 265, 185],
    sat: 88,
    harmony: 150,
    titleFonts: ["Archivo Black", "Bricolage Grotesque", "Bebas Neue"],
    bodyFont: "IBM Plex Sans",
    subtitleStyle: "boxed",
    lightThird: false,
    names: ["Électrique", "Néon", "Terminal"],
  },
  naturel: {
    hues: [140, 20, 38],
    sat: 45,
    harmony: 40,
    titleFonts: ["DM Serif Display", "Bricolage Grotesque", "DM Serif Display"],
    bodyFont: "Poppins",
    subtitleStyle: "boxed",
    lightThird: true,
    names: ["Forêt", "Terracotta", "Sable"],
  },
  pro: {
    hues: [215, 175, 28],
    sat: 65,
    harmony: 180,
    titleFonts: ["Bricolage Grotesque", "Archivo Black", "Bricolage Grotesque"],
    bodyFont: "IBM Plex Sans",
    subtitleStyle: "boxed",
    lightThird: true,
    names: ["Marine", "Sarcelle", "Papier"],
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/** Éclaircit ou fonce une couleur jusqu'à atteindre le contraste voulu contre le fond. */
export function ensureContrast(hex: string, against: string, min: number): string {
  const [h, s, l0] = hexToHsl(hex);
  const lighter = contrastRatio(against, "#FFFFFF") > contrastRatio(against, "#000000");
  let l = l0;
  let out = hex;
  for (let i = 0; i < 60 && contrastRatio(out, against) < min; i++) {
    l += lighter ? 1.5 : -1.5;
    out = hslToHex(h, s, l);
  }
  return out;
}

function proposal(preset: Preset, i: 0 | 1 | 2, baseHex: string | null): BrandProposal {
  const light = preset.lightThird && i === 2;
  let hue = preset.hues[i];
  let sat = preset.sat;
  if (baseHex) {
    // Avec la couleur du créateur : elle reste la principale, et chaque proposition varie
    // l'harmonie (complémentaire, analogue, triadique) et le fond.
    [hue, sat] = hexToHsl(baseHex);
    sat = Math.max(sat, 35);
  }
  const harmony = baseHex ? [180, 35, 120][i]! : preset.harmony;
  const background = light ? hslToHex(hue + 10, 30, 95) : hslToHex(hue + 200, 18, i === 1 ? 9 : 7);
  const text = light ? hslToHex(hue, 25, 12) : hslToHex(hue + 30, 20, 95);
  const primaryRaw = baseHex && i === 0 ? baseHex.toUpperCase() : hslToHex(hue, sat, light ? 42 : 58);
  const primary = ensureContrast(primaryRaw, background, 3);
  const secondary = ensureContrast(
    hslToHex(hue + harmony, Math.max(30, sat - 10), light ? 38 : 62),
    background,
    3,
  );
  return {
    name: preset.names[i],
    why: `${light ? "Fond clair" : "Fond sombre"}, ${preset.titleFonts[i]} pour les titres : ${
      preset.subtitleStyle === "word"
        ? "sous-titres mot par mot, idéal pour garder l'attention"
        : preset.subtitleStyle === "outline"
          ? "sous-titres légers à contour, qui laissent respirer l'image"
          : "sous-titres encadrés, lisibles sur n'importe quel plan"
    }.`,
    colors: [
      { name: "Principale", hex: primary },
      { name: "Secondaire", hex: secondary },
      { name: "Fond", hex: background },
      { name: "Texte", hex: ensureContrast(text, background, 7) },
    ],
    titleFont: preset.titleFonts[i],
    bodyFont: preset.bodyFont,
    subtitleStyle: preset.subtitleStyle,
    subtitlePosition: preset.subtitleStyle === "word" ? "center" : "bottom",
  };
}

/** Trois propositions de Brand Kit pour une ambiance. */
export function proposeBrandKits(mood: Mood, baseHex?: string | null): BrandProposal[] {
  const preset = PRESETS[mood];
  const base = baseHex && HEX.test(baseHex) ? baseHex : null;
  return ([0, 1, 2] as const).map((i) => proposal(preset, i, base));
}
