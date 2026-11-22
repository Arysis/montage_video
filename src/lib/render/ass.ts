import type { EditPlan } from "@/lib/plan/schema";
import { boldFor } from "@/lib/fonts";
import { buildCues, safeZone, subtitleLayout, wrapLines } from "@/lib/plan/subtitles";

/** Couleur #RRGGBB vers le format ASS &HAABBGGRR. */
export function assColor(hex: string, alpha = 0): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export function assTime(sec: number): string {
  const total = Math.round(Math.max(0, sec) * 100);
  const cs = total % 100;
  const whole = Math.floor(total / 100);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

/**
 * Génère le fichier de sous-titres ASS (sous-titres, textes à l'écran, filigrane).
 * libass l'incruste ensuite dans l'image avec les polices du Brand Kit.
 */
export function buildAss(plan: EditPlan, opts: { watermarkText?: string } = {}): string {
  const s = plan.subtitles;
  const layout = subtitleLayout(plan);
  const zone = safeZone(plan);
  const boxed = s.style === "boxed" || s.style === "word";
  const align = s.position === "bottom" ? 2 : 5;
  const titleSize = Math.round(s.sizePx * 1.2);

  const style = (
    name: string,
    font: string,
    size: number,
    primary: string,
    outline: string,
    borderStyle: number,
    outlineW: number,
    alignment: number,
    marginL: number,
    marginR: number,
    marginV: number,
  ) =>
    `Style: ${name},${font},${size},${primary},${primary},${outline},${outline},${boldFor(font) ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outlineW},0,${alignment},${marginL},${marginR},${marginV},1`;

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${plan.width}`,
    `PlayResY: ${plan.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style(
      "Sub",
      s.font,
      s.sizePx,
      assColor(s.color),
      boxed ? assColor(s.boxColor, 0x20) : assColor("#000000"),
      boxed ? 3 : 1,
      boxed ? 14 : Math.max(3, Math.round(s.sizePx / 14)),
      align,
      layout.marginL,
      layout.marginR,
      layout.marginV,
    ),
    style(
      "Title",
      plan.brand.titleFont,
      titleSize,
      assColor(plan.brand.text),
      assColor(plan.brand.background, 0x20),
      3,
      18,
      8,
      layout.marginH,
      layout.marginH,
      Math.round(zone.top + 40),
    ),
    style(
      "Big",
      plan.brand.titleFont,
      Math.round(titleSize * 1.45),
      assColor(plan.brand.text),
      assColor("#000000", 0x60),
      1,
      Math.max(3, Math.round(titleSize / 16)),
      5,
      layout.marginH,
      layout.marginH,
      0,
    ),
    style(
      "Mark",
      plan.brand.bodyFont,
      Math.round(s.sizePx * 0.45),
      assColor("#FFFFFF", 0x40),
      assColor("#000000", 0x80),
      1,
      2,
      7,
      Math.round(zone.left + 10),
      0,
      Math.round(zone.top / 2),
    ),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const ev = (layer: number, start: number, end: number, styleName: string, text: string) =>
    lines.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${text}`);

  if (s.enabled) {
    for (const cue of buildCues(plan)) {
      const words = cue.words.map((w) => escapeAss(w.word));
      if (s.style === "word") {
        // Le mot lu est mis en avant dans la couleur principale.
        cue.words.forEach((w, i) => {
          const start = i === 0 ? cue.start : w.start;
          const end = i === cue.words.length - 1 ? cue.end : cue.words[i + 1]!.start;
          const text = words
            .map((t, j) => (j === i ? `{\\c${assColor(s.highlightColor)}}${t}{\\c${assColor(s.color)}}` : t))
            .join(" ");
          ev(1, start, end, "Sub", wrapAss(text, words, layout.maxChars));
        });
      } else {
        ev(1, cue.start, cue.end, "Sub", wrapAss(words.join(" "), words, layout.maxChars));
      }
    }
  }

  // Texte à l'écran : il apparaît en « pop » (petit rebond). Sur un fond généré, il prend
  // toute la place au centre, comme un titre animé ; sur une image, il reste en haut.
  const pop = "{\\fad(80,160)\\fscx70\\fscy70\\t(0,160,\\fscx108\\fscy108)\\t(160,260,\\fscx100\\fscy100)}";
  for (const scene of plan.scenes) {
    if (scene.overlayText) {
      const big = scene.visual.type !== "asset" && !scene.character;
      const width = big ? Math.max(8, Math.round(layout.maxChars / 1.45)) : layout.maxChars;
      const text = wrapLines(escapeAss(scene.overlayText), width).join("\\N");
      const end = big ? scene.end : Math.min(scene.end, scene.start + 3);
      ev(2, scene.start, end, big ? "Big" : "Title", `${pop}${text}`);
    }
  }

  if (plan.outro) {
    const start = plan.durationSec - plan.outro.durationSec;
    ev(2, start, plan.durationSec, "Title", escapeAss(plan.outro.text));
  }

  if (plan.watermark && opts.watermarkText) {
    ev(3, 0, plan.durationSec, "Mark", escapeAss(opts.watermarkText));
  }
  return lines.join("\n") + "\n";
}

/** Ajoute un retour à la ligne ASS (\N) en respectant la largeur, sans casser les balises de couleur. */
function wrapAss(text: string, plainWords: string[], maxChars: number): string {
  const plain = plainWords.join(" ");
  if (plain.length <= maxChars) return text;
  const wrapped = wrapLines(plain, maxChars);
  if (wrapped.length < 2) return text;
  const firstLineWords = wrapped[0]!.split(" ").length;
  const tokens = text.split(" ");
  // Les balises sont collées aux mots : on coupe après le n-ième mot.
  return [tokens.slice(0, firstLineWords).join(" "), tokens.slice(firstLineWords).join(" ")].join("\\N");
}
