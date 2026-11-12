import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import type { Project, User } from "@/lib/db/schema";

export async function ownedProject(userId: string, projectId: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/.test(projectId)) notFound();
  const [p] = await db()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  if (!p) notFound();
  return p;
}

export function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function usage(user: User) {
  const [row] = await db()
    .select({ n: count() })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, user.id), gte(schema.projects.countedAt, monthStart())));
  const limits = planLimits(user.plan);
  return { used: row?.n ?? 0, limit: limits.videosPerMonth };
}

export async function projectAssets(projectId: string) {
  const links = await db()
    .select({ asset: schema.assets })
    .from(schema.projectAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.projectAssets.assetId))
    .where(eq(schema.projectAssets.projectId, projectId));
  return links.map((l) => l.asset);
}

export async function linkAssets(userId: string, projectId: string, assetIds: string[]) {
  const valid = assetIds.filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (!valid.length) return;
  const owned = await db()
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.userId, userId), inArray(schema.assets.id, valid)));
  if (owned.length) {
    await db()
      .insert(schema.projectAssets)
      .values(owned.map((a) => ({ projectId, assetId: a.id })))
      .onConflictDoNothing();
  }
}

export async function recentProjects(userId: string) {
  return db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(48);
}

export const STATUS_LABELS: Record<Project["status"], string> = {
  draft: "Brouillon",
  script: "Script",
  prompteur: "Prompteur",
  montage: "Montage",
  ready: "Prête",
  scheduled: "Programmée",
  published: "Publiée",
};

export const PLATFORM_SHORT: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Reel",
  youtube: "Short",
};

/** Le script détaillé attend d'être relu et validé (les anciens projets passent directement). */
export function needsScriptValidation(p: Pick<Project, "script" | "status">): boolean {
  return !!p.script && !p.script.validatedAt && (p.status === "draft" || p.status === "script");
}

/** Étape où reprendre un projet. */
export function projectStep(p: Project): string {
  if (!p.script) return "idee";
  if (needsScriptValidation(p)) return "script";
  if (!p.selectedTakeId) return "prompteur";
  if (p.status === "ready" || p.status === "scheduled" || p.status === "published") return "publication";
  return "montage";
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return "--:--";
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
export const formatDate = (d: Date) => dateFmt.format(d);
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);
