/**
 * Contrôle qualité automatique : 11 tests, à trois moments.
 * Une vidéo avec un test « fail » ne peut pas être publiée.
 */

export const QC_TESTS = [
  { id: "plan-validity", stage: "pre-render", label: "Validité du plan" },
  { id: "voice-scenes", stage: "pre-render", label: "Cohérence voix et scènes" },
  { id: "brand-kit", stage: "pre-render", label: "Brand Kit respecté" },
  { id: "rights", stage: "pre-render", label: "Droits des fichiers" },
  { id: "technical", stage: "post-render", label: "Fichier technique" },
  { id: "frames", stage: "post-render", label: "Images" },
  { id: "audio", stage: "post-render", label: "Son" },
  { id: "sync", stage: "post-render", label: "Synchronisation" },
  { id: "readability", stage: "post-render", label: "Lisibilité" },
  { id: "ai-review", stage: "post-render", label: "Relecture par l'IA" },
  { id: "platform", stage: "pre-publish", label: "Conformité plateforme" },
] as const;

export type QcTestId = (typeof QC_TESTS)[number]["id"];
export type QcStage = (typeof QC_TESTS)[number]["stage"];
export type QcStatus = "pass" | "warn" | "fail" | "skipped";

export type QcCheck = {
  /** Identifiant stable, utilisé pour « Garder tel quel ». */
  key: string;
  testId: QcTestId;
  status: QcStatus;
  /** Titre court affiché : « Sous-titres synchronisés », « Plan 3 trop long ». */
  title: string;
  /** Détail : « 6,4 s sans changement d'image. Vise moins de 4 s. » */
  detail?: string;
  /** Scène concernée, pour proposer « Refaire cette partie ». */
  sceneId?: string;
};

export type QcReport = {
  planVersion: number;
  checkedAt: string;
  attempts: number;
  checks: QcCheck[];
};

export function worstStatus(checks: QcCheck[]): QcStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.length && checks.every((c) => c.status === "skipped")) return "skipped";
  return "pass";
}

/** Un test rouge bloque la publication. Un test orange se valide avec « Garder tel quel ». */
export function blocksPublication(report: QcReport | null | undefined): boolean {
  if (!report) return true;
  return report.checks.some((c) => c.status === "fail");
}

export function pendingWarnings(report: QcReport | null | undefined, acknowledged: string[]): QcCheck[] {
  if (!report) return [];
  return report.checks.filter((c) => c.status === "warn" && !acknowledged.includes(c.key));
}
