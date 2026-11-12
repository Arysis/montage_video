import { buildCues, CHAR_WIDTH_RATIO, safeZone, subtitleLayout } from "@/lib/plan/subtitles";
import type { EditPlan } from "@/lib/plan/schema";
import type { QcCheck } from "./types";

/** Rapport de contraste WCAG entre deux couleurs #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
      number,
      number,
      number,
    ];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Test 9 : sous-titres et textes dans la zone sûre, contraste suffisant, pas de texte coupé. */
export function checkReadability(plan: EditPlan): QcCheck[] {
  const checks: QcCheck[] = [];
  const zone = safeZone(plan);
  const layout = subtitleLayout(plan);

  const inZone = layout.rect.top >= zone.top && layout.rect.bottom <= plan.height - zone.bottom;
  checks.push({
    key: "readability:safe-zone",
    testId: "readability",
    status: inZone ? "pass" : "fail",
    title: inZone ? "Sous-titres dans la zone visible" : "Sous-titres cachés par l'interface",
    detail: inZone ? undefined : "Les boutons TikTok ou Instagram recouvriraient le texte.",
  });

  if (plan.logo) {
    const logoW = plan.width * plan.logo.widthRatio;
    const ok = logoW + zone.right + 24 <= plan.width && zone.top >= 0;
    checks.push({
      key: "readability:logo",
      testId: "readability",
      status: ok ? "pass" : "warn",
      title: ok ? "Logo dans la zone visible" : "Logo trop grand",
    });
  }

  const fg = plan.subtitles.color;
  const bg = plan.subtitles.style === "outline" ? "#000000" : plan.subtitles.boxColor;
  const ratio = contrastRatio(fg, bg);
  const hl = contrastRatio(plan.subtitles.highlightColor, bg);
  const min = Math.min(ratio, plan.subtitles.style === "word" ? hl : ratio);
  checks.push({
    key: "readability:contrast",
    testId: "readability",
    status: min >= 4.5 ? "pass" : min >= 3 ? "warn" : "fail",
    title: min >= 4.5 ? "Contraste des sous-titres suffisant" : "Contraste des sous-titres faible",
    detail: `Rapport ${min.toFixed(1).replace(".", ",")}:1 (4,5:1 conseillé).`,
  });

  const maxWordPx = Math.max(
    0,
    ...plan.subtitles.words.map((w) => w.word.length * plan.subtitles.sizePx * CHAR_WIDTH_RATIO),
  );
  const overlayTooLong = plan.scenes.find(
    (s) =>
      s.overlayText &&
      s.overlayText.length * plan.subtitles.sizePx * 1.2 * CHAR_WIDTH_RATIO > layout.availableWidth * 2,
  );
  const cut = maxWordPx > layout.availableWidth || !!overlayTooLong;
  checks.push({
    key: "readability:cut",
    testId: "readability",
    status: cut ? "warn" : "pass",
    title: cut ? "Texte qui risque d'être coupé" : "Aucun texte coupé",
    sceneId: overlayTooLong?.id,
  });

  const cues = buildCues(plan);
  const tooFast = cues.find((c) => {
    const chars = c.words.map((w) => w.word).join(" ").length;
    return chars / Math.max(0.3, c.end - c.start) > 25;
  });
  checks.push({
    key: "readability:speed",
    testId: "readability",
    status: tooFast ? "warn" : "pass",
    title: tooFast ? "Sous-titres qui défilent vite" : "Sous-titres lisibles à la bonne vitesse",
  });
  return checks;
}

export type Platform = "tiktok" | "instagram" | "youtube";

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
};

/**
 * Limites connues des plateformes (à revérifier régulièrement, elles changent).
 * Sources : documentation développeur TikTok Content Posting API, Instagram Graph API (Reels), YouTube Shorts.
 */
export const PLATFORM_RULES: Record<
  Platform,
  { minSec: number; maxSec: number; maxBytes: number; formats: EditPlan["format"][] }
> = {
  tiktok: { minSec: 3, maxSec: 600, maxBytes: 4 * 1024 ** 3, formats: ["9:16", "1:1", "16:9"] },
  instagram: { minSec: 3, maxSec: 900, maxBytes: 300 * 1024 ** 2, formats: ["9:16", "1:1"] },
  youtube: { minSec: 1, maxSec: 180, maxBytes: 256 * 1024 ** 3, formats: ["9:16", "1:1"] },
};

/** Test 11 : durée, poids, format et ratio acceptés par chaque réseau. */
export function checkPlatforms(
  platforms: string[],
  video: { durationSec: number; sizeBytes: number; format: EditPlan["format"] },
): QcCheck[] {
  const valid = platforms.filter((p): p is Platform => p in PLATFORM_RULES);
  if (!valid.length) {
    return [
      { key: "platform:none", testId: "platform", status: "skipped", title: "Aucune plateforme choisie" },
    ];
  }
  return valid.map((p) => {
    const r = PLATFORM_RULES[p];
    const problems: string[] = [];
    if (video.durationSec < r.minSec) problems.push(`moins de ${r.minSec} s`);
    if (video.durationSec > r.maxSec) problems.push(`plus de ${r.maxSec} s`);
    if (video.sizeBytes > r.maxBytes) problems.push("fichier trop lourd");
    if (!r.formats.includes(video.format)) problems.push(`format ${video.format} refusé`);
    return problems.length
      ? {
          key: `platform:${p}`,
          testId: "platform" as const,
          status: "fail" as const,
          title: `Refusée par ${PLATFORM_LABELS[p]}`,
          detail: problems.join(", "),
        }
      : {
          key: `platform:${p}`,
          testId: "platform" as const,
          status: "pass" as const,
          title: `Durée adaptée à ${PLATFORM_LABELS[p]}`,
        };
  });
}
