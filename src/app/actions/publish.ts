"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ai, AiNotConfiguredError } from "@/lib/ai";
import { requireUser } from "@/lib/auth/session";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import { enqueue, QUEUES } from "@/lib/jobs";
import { ownedProject } from "@/lib/projects";
import { publisher } from "@/lib/publish";
import { checkPlatforms, PLATFORM_LABELS, type Platform } from "@/lib/qc/rules";
import { blocksPublication, pendingWarnings } from "@/lib/qc/types";
import { parisToUtc } from "@/lib/time";

export type PublishState = { error?: string } | undefined;

/** Crée l'espace de publication si besoin et envoie vers la page où l'on relie ses comptes. */
export async function connectAccounts(projectId: string) {
  const user = await requireUser();
  let profileKey = user.publishProfileKey;
  let url: string;
  try {
    if (!profileKey) {
      profileKey = await publisher().createProfile(user.id);
      await db()
        .update(schema.users)
        .set({ publishProfileKey: profileKey })
        .where(eq(schema.users.id, user.id));
    }
    url = await publisher().linkUrl(profileKey);
  } catch (err) {
    console.error("[publish] liaison", err);
    redirect(`/app/projets/${projectId}/publication?erreur=liaison`);
  }
  // Publication simulée : on revient directement sur la page.
  redirect(url.startsWith("/") ? `/app/projets/${projectId}/publication` : url);
}

export async function suggestCaption(
  projectId: string,
  previous: string,
): Promise<{ caption?: string; hashtags?: string; error?: string }> {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  if (!p.script) return { error: "Aucun script." };
  try {
    const c = await ai().proposeCaption({
      script: p.script,
      platforms: p.platforms,
      previous: previous.slice(0, 2200),
    });
    return {
      caption: c.caption,
      hashtags: c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
    };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return { error: err.message };
    console.error("[ai] légende", err);
    return { error: "L'IA n'a pas pu proposer de légende. Réessaie." };
  }
}

const schemaPublish = z.object({
  projectId: z.string().uuid(),
  platforms: z.array(z.enum(["tiktok", "instagram", "youtube"])).min(1, "Choisis au moins une plateforme."),
  caption: z.string().trim().max(2200, "Légende trop longue (2 200 caractères au plus)."),
  hashtags: z.string().trim().max(500, "Trop de hashtags."),
  when: z.enum(["now", "later"]),
  date: z.string().optional(),
  time: z.string().optional(),
});

export async function publishVideo(_prev: PublishState, form: FormData): Promise<PublishState> {
  const user = await requireUser();
  const parsed = schemaPublish.safeParse({
    projectId: form.get("projectId"),
    platforms: form.getAll("platforms"),
    caption: form.get("caption") ?? "",
    hashtags: form.get("hashtags") ?? "",
    when: form.get("when"),
    date: form.get("date") ?? undefined,
    time: form.get("time") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const data = parsed.data;
  const p = await ownedProject(user.id, data.projectId);

  if (!p.renderKey || !p.renderDurationSec || !p.renderSizeBytes)
    return { error: "La vidéo n'est pas encore montée." };
  if (p.renderStatus === "queued" || p.renderStatus === "running")
    return { error: "Un montage est en cours." };
  if (blocksPublication(p.qcReport))
    return { error: "Le contrôle qualité bloque la publication. Corrige d'abord les points rouges." };
  if (pendingWarnings(p.qcReport, p.acknowledgedWarnings).length) {
    return { error: "Des points du contrôle qualité restent à revoir sur la page Montage." };
  }
  const platformChecks = checkPlatforms(data.platforms, {
    durationSec: p.renderDurationSec,
    sizeBytes: p.renderSizeBytes,
    format: p.format,
  });
  const blocked = platformChecks.find((c) => c.status === "fail");
  if (blocked) return { error: `${blocked.title}. ${blocked.detail ?? ""}`.trim() };

  if (!user.publishProfileKey) return { error: "Relie d'abord tes comptes." };
  try {
    const accounts = await publisher().connectedAccounts(user.publishProfileKey);
    const missing = data.platforms.filter((pl) => !accounts.some((a) => a.platform === pl));
    if (missing.length) {
      return {
        error: `Compte non relié : ${missing.map((m) => PLATFORM_LABELS[m as Platform]).join(", ")}.`,
      };
    }
  } catch (err) {
    console.error("[publish] comptes", err);
    return { error: "Impossible de vérifier tes comptes. Réessaie dans un instant." };
  }

  let scheduledAt = new Date();
  if (data.when === "later") {
    if (!planLimits(user.plan).scheduling)
      return { error: "La programmation est incluse dans l'offre Créateur." };
    const at = data.date && data.time ? parisToUtc(data.date, data.time) : null;
    if (!at) return { error: "Choisis une date et une heure." };
    if (at.getTime() < Date.now() + 5 * 60_000)
      return { error: "Choisis une heure au moins 5 minutes plus tard." };
    if (at.getTime() > Date.now() + 365 * 24 * 3600_000)
      return { error: "Choisis une date dans les 12 prochains mois." };
    scheduledAt = at;
  }

  const [pub] = await db()
    .insert(schema.publications)
    .values({
      projectId: p.id,
      userId: user.id,
      platforms: data.platforms,
      caption: data.caption,
      hashtags: data.hashtags,
      scheduledAt,
      status: "scheduled",
    })
    .returning();
  await db()
    .update(schema.projects)
    .set({
      caption: data.caption,
      hashtags: data.hashtags,
      status: data.when === "later" ? "scheduled" : p.status,
    })
    .where(eq(schema.projects.id, p.id));
  await enqueue(QUEUES.publish, { publicationId: pub!.id });
  revalidatePath(`/app/projets/${p.id}/publication`);
  revalidatePath("/app");
  redirect(`/app/projets/${p.id}/publication?envoye=1`);
}
