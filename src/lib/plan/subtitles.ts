import type { EditPlan } from "./schema";

export type Cue = { start: number; end: number; words: { word: string; start: number; end: number }[] };

/** Zones sûres (pixels pour 1080 de large) : ce que l'interface TikTok, Reels ou Shorts recouvre. */
export function safeZone(plan: Pick<EditPlan, "format" | "width" | "height">) {
  const scale = plan.width / 1080;
  if (plan.format === "9:16") {
    return { top: 250 * scale, bottom: 440 * scale, left: 60 * scale, right: 140 * scale };
  }
  if (plan.format === "1:1")
    return { top: 60 * scale, bottom: 120 * scale, left: 60 * scale, right: 60 * scale };
  return { top: 60 * scale, bottom: 100 * scale, left: 80 * scale, right: 80 * scale };
}

/** Largeur moyenne d'un caractère, en fraction de la taille de police (police sans empattement grasse). */
export const CHAR_WIDTH_RATIO = 0.56;

export function subtitleLayout(plan: EditPlan) {
  const zone = safeZone(plan);
  const marginH = Math.round(Math.max(zone.left, zone.right) + 20);
  const availableWidth = plan.width - 2 * marginH;
  const maxChars = Math.max(10, Math.floor(availableWidth / (plan.subtitles.sizePx * CHAR_WIDTH_RATIO)));
  const lineHeight = Math.round(plan.subtitles.sizePx * 1.25);
  const blockHeight = lineHeight * 2 + 24;
  const marginV =
    plan.subtitles.position === "bottom"
      ? Math.round(zone.bottom + 20)
      : Math.round(plan.height / 2 - blockHeight / 2);
  // Rectangle occupé par les sous-titres (deux lignes au plus), pour le test de lisibilité.
  const top = plan.subtitles.position === "bottom" ? plan.height - marginV - blockHeight : marginV;
  return { marginH, marginV, availableWidth, maxChars, rect: { top, bottom: top + blockHeight } };
}

/**
 * Regroupe les mots en sous-titres courts : deux lignes au plus, coupure sur la ponctuation,
 * jamais plus de 2,5 s à l'écran.
 */
export function buildCues(plan: EditPlan): Cue[] {
  const { maxChars } = subtitleLayout(plan);
  const maxCueChars = plan.subtitles.style === "word" ? Math.min(maxChars, 18) : maxChars * 2;
  const cues: Cue[] = [];
  let current: Cue | null = null;
  for (const w of plan.subtitles.words) {
    const text = current ? current.words.map((x) => x.word).join(" ") : "";
    const wouldBe = text ? `${text} ${w.word}` : w.word;
    const tooLong = current && (wouldBe.length > maxCueChars || w.end - current.start > 2.5);
    const gap = current && w.start - current.end > 0.6;
    if (!current || tooLong || gap) {
      if (current) cues.push(current);
      current = { start: w.start, end: w.end, words: [w] };
    } else {
      current.words.push(w);
      current.end = w.end;
    }
    if (/[.!?…]$/.test(w.word) && current) {
      cues.push(current);
      current = null;
    }
  }
  if (current) cues.push(current);
  // Laisser chaque sous-titre jusqu'au suivant (au plus 0,5 s de plus) pour éviter le clignotement.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const extended = Math.min(cues[i]!.end + 0.5, next ? next.start : plan.durationSec);
    cues[i]!.end = Math.round(Math.max(cues[i]!.end, extended) * 100) / 100;
  }
  return cues;
}

/** Découpe un texte en lignes de maxChars caractères au plus (sans couper un mot). */
export function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
