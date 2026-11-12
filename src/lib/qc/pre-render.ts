import { sceneSpans } from "@/lib/plan/align";
import { brandPalette, type BrandInput } from "@/lib/plan/build";
import { editPlanSchema, type EditPlan, referencedAssetIds } from "@/lib/plan/schema";
import type { Script } from "@/lib/script/schema";
import type { WordTiming } from "@/lib/stt/types";
import type { QcCheck } from "./types";

export type QcAsset = {
  id: string;
  kind: string;
  name: string;
  rights: "own" | "licensed" | "free" | "unknown";
};

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const sceneNumber = (id: string) => id.replace(/^s/, "").split(".")[0];

/** Test 1 : le JSON respecte le schéma, chaque asset cité existe, aucune scène vide, durée conforme. */
export function checkPlanValidity(
  plan: unknown,
  ctx: { assets: QcAsset[]; targetDurationSec: number; maxDurationSec: number },
): QcCheck[] {
  const parsed = editPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return [
      {
        key: "plan-validity:schema",
        testId: "plan-validity",
        status: "fail",
        title: "Plan de montage invalide",
        detail: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")} : ${i.message}`)
          .join(" ; "),
      },
    ];
  }
  const p = parsed.data;
  const checks: QcCheck[] = [];
  const known = new Set(ctx.assets.map((a) => a.id));
  const missing = referencedAssetIds(p).filter((id) => !known.has(id));
  checks.push(
    missing.length
      ? {
          key: "plan-validity:assets",
          testId: "plan-validity",
          status: "fail",
          title: "Fichier introuvable dans ta bibliothèque",
          detail: `${missing.length} fichier(s) cité(s) par le montage n'existent plus.`,
        }
      : {
          key: "plan-validity:assets",
          testId: "plan-validity",
          status: "pass",
          title: "Tous les fichiers sont présents",
        },
  );

  const empty = p.scenes.filter((s) => s.end - s.start < 0.3);
  const gaps = p.scenes.slice(1).filter((s, i) => Math.abs(s.start - p.scenes[i]!.end) > 0.05);
  if (empty.length || gaps.length) {
    checks.push({
      key: "plan-validity:scenes",
      testId: "plan-validity",
      status: "fail",
      title: empty.length ? `Plan ${sceneNumber(empty[0]!.id)} vide` : "Trou entre deux plans",
      detail: empty.length ? "Un plan dure moins de 0,3 s." : "L'image s'arrête entre deux plans.",
      sceneId: (empty[0] ?? gaps[0])!.id,
    });
  } else {
    checks.push({
      key: "plan-validity:scenes",
      testId: "plan-validity",
      status: "pass",
      title: "Aucun plan vide",
    });
  }

  const d = p.durationSec;
  if (d > ctx.maxDurationSec + 0.5) {
    checks.push({
      key: "plan-validity:duration",
      testId: "plan-validity",
      status: "fail",
      title: "Vidéo trop longue pour ton offre",
      detail: `${fmt(d)} s pour ${ctx.maxDurationSec} s au plus.`,
    });
  } else if (Math.abs(d - ctx.targetDurationSec) / ctx.targetDurationSec > 0.5) {
    checks.push({
      key: "plan-validity:duration",
      testId: "plan-validity",
      status: "warn",
      title: "Durée éloignée de ta demande",
      detail: `${fmt(d)} s au lieu de ${ctx.targetDurationSec} s environ.`,
    });
  } else {
    checks.push({
      key: "plan-validity:duration",
      testId: "plan-validity",
      status: "pass",
      title: "Durée conforme à ta demande",
      detail: `${fmt(d)} s`,
    });
  }
  return checks;
}

/** Test 2 : chaque phrase du script a sa scène, pas de trou dans la voix, pas de plan trop long. */
export function checkVoiceScenes(plan: EditPlan, script: Script, words: WordTiming[]): QcCheck[] {
  const checks: QcCheck[] = [];
  const spans = sceneSpans(script.scenes, words);
  const missing = spans.filter((s) => s.coverage < 0.2);
  const partial = spans.filter((s) => s.coverage >= 0.2 && s.coverage < 0.6);
  if (missing.length) {
    checks.push({
      key: "voice-scenes:coverage",
      testId: "voice-scenes",
      status: "fail",
      title: `Scène ${sceneNumber(missing[0]!.sceneId)} absente de la voix`,
      detail: "Cette partie du script n'a pas été dite dans la prise retenue.",
      sceneId: missing[0]!.sceneId,
    });
  } else if (partial.length) {
    checks.push({
      key: `voice-scenes:partial:${partial[0]!.sceneId}`,
      testId: "voice-scenes",
      status: "warn",
      title: `Scène ${sceneNumber(partial[0]!.sceneId)} dite en partie`,
      detail: "Une partie des mots du script manque dans la voix.",
      sceneId: partial[0]!.sceneId,
    });
  } else {
    checks.push({
      key: "voice-scenes:coverage",
      testId: "voice-scenes",
      status: "pass",
      title: "Chaque phrase a sa scène",
    });
  }

  let longestPause = 0;
  for (let i = 1; i < words.length; i++)
    longestPause = Math.max(longestPause, words[i]!.start - words[i - 1]!.end);
  checks.push(
    longestPause > 2
      ? {
          key: "voice-scenes:pause",
          testId: "voice-scenes",
          status: "warn",
          title: "Long blanc dans la voix",
          detail: `Un silence de ${fmt(longestPause)} s.`,
        }
      : {
          key: "voice-scenes:pause",
          testId: "voice-scenes",
          status: "pass",
          title: "Pas de blanc dans la voix",
        },
  );

  for (const scene of plan.scenes) {
    const len = scene.end - scene.start;
    if (len > 4.5) {
      checks.push({
        key: `voice-scenes:long:${scene.id}`,
        testId: "voice-scenes",
        status: "warn",
        title: `Plan ${sceneNumber(scene.id)} trop long`,
        detail: `${fmt(len)} s sans changement d'image. Vise moins de 4 s.`,
        sceneId: scene.id,
      });
    }
  }
  return checks;
}

/** Test 3 : polices, couleurs et logo conformes au Brand Kit. */
export function checkBrandKit(plan: EditPlan, brand: BrandInput): QcCheck[] {
  const palette = brandPalette(brand.colors);
  const checks: QcCheck[] = [];
  const colorsOk =
    plan.brand.primary.toLowerCase() === palette.primary.toLowerCase() &&
    plan.brand.text.toLowerCase() === palette.text.toLowerCase() &&
    plan.subtitles.highlightColor.toLowerCase() === palette.primary.toLowerCase();
  checks.push({
    key: "brand-kit:colors",
    testId: "brand-kit",
    status: colorsOk ? "pass" : "fail",
    title: colorsOk ? "Couleurs du Brand Kit respectées" : "Couleurs différentes du Brand Kit",
  });
  const fontsOk = plan.brand.titleFont === brand.titleFont && plan.subtitles.font === brand.bodyFont;
  checks.push({
    key: "brand-kit:fonts",
    testId: "brand-kit",
    status: fontsOk ? "pass" : "fail",
    title: fontsOk ? "Polices du Brand Kit respectées" : "Polices différentes du Brand Kit",
  });
  if (brand.logoAssetId) {
    const ok = !!plan.logo && plan.logo.assetId === brand.logoAssetId && plan.logo.showFrom <= 2;
    checks.push({
      key: "brand-kit:logo",
      testId: "brand-kit",
      status: ok ? "pass" : "warn",
      title: ok ? "Logo visible dans les 2 premières secondes" : "Logo absent du début",
    });
  } else {
    checks.push({
      key: "brand-kit:logo",
      testId: "brand-kit",
      status: "skipped",
      title: "Pas de logo dans ton Brand Kit",
    });
  }
  return checks;
}

/** Test 4 : chaque fichier utilisé a des droits compatibles avec la publication. */
export function checkRights(plan: EditPlan, assets: QcAsset[]): QcCheck[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const unknown = referencedAssetIds(plan)
    .map((id) => byId.get(id))
    .filter((a): a is QcAsset => !!a && a.rights === "unknown");
  if (unknown.length) {
    return [
      {
        key: "rights:unknown",
        testId: "rights",
        status: "fail",
        title: `Droits inconnus : ${unknown[0]!.name}`,
        detail: "Indique dans ta bibliothèque si tu as le droit de publier ce fichier.",
      },
    ];
  }
  return [
    { key: "rights:ok", testId: "rights", status: "pass", title: "Droits vérifiés pour chaque fichier" },
  ];
}
