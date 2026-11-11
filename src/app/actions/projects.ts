"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ai, AiNotConfiguredError } from "@/lib/ai";
import { requireUser } from "@/lib/auth/session";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import { enqueue, QUEUES } from "@/lib/jobs";
import { linkAssets, ownedProject, projectAssets, usage } from "@/lib/projects";
import { scriptFromEditorText } from "@/lib/script/schema";
import { storage } from "@/lib/storage";

export type ActionState = { error?: string; ok?: string } | undefined;

const ideaSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(10, "Décris ton idée en une phrase au moins.")
    .max(4000, "Ton idée est trop longue."),
  format: z.enum(["9:16", "1:1", "16:9"]),
  platforms: z.array(z.enum(["tiktok", "instagram", "youtube"])).min(1, "Choisis au moins une plateforme."),
  duration: z.coerce
    .number()
    .int()
    .refine((n) => [15, 30, 45, 60, 90].includes(n), "Durée invalide."),
});

function aiError(err: unknown): string {
  if (err instanceof AiNotConfiguredError) return "L'IA n'est pas encore configurée sur ce serveur.";
  console.error("[ai]", err);
  return err instanceof Error && err.message.length < 160
    ? err.message
    : "L'IA n'a pas pu écrire le script. Réessaie.";
}

/** Étape 1 : crée le projet et fait écrire le script par l'IA. */
export async function createProject(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ideaSchema.safeParse({
    idea: form.get("idea"),
    format: form.get("format"),
    platforms: form.getAll("platforms"),
    duration: form.get("duration"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const limits = planLimits(user.plan);
  if (parsed.data.duration > limits.maxDurationSec) {
    return { error: `Ton offre permet des vidéos de ${limits.maxDurationSec} s au plus.` };
  }
  const assetIds = form.getAll("assetIds").map(String);
  const existingId = String(form.get("projectId") ?? "");
  let projectId: string;
  if (existingId) {
    const p = await ownedProject(user.id, existingId);
    await db()
      .update(schema.projects)
      .set({
        idea: parsed.data.idea,
        format: parsed.data.format,
        platforms: parsed.data.platforms,
        targetDurationSec: parsed.data.duration,
      })
      .where(eq(schema.projects.id, p.id));
    projectId = p.id;
  } else {
    const [p] = await db()
      .insert(schema.projects)
      .values({
        userId: user.id,
        name: parsed.data.idea.split(/[.!?\n]/)[0]!.slice(0, 60),
        idea: parsed.data.idea,
        format: parsed.data.format,
        platforms: parsed.data.platforms,
        targetDurationSec: parsed.data.duration,
      })
      .returning();
    projectId = p!.id;
  }
  await linkAssets(user.id, projectId, assetIds);

  try {
    const assets = await projectAssets(projectId);
    const script = await ai().generateScript({
      idea: parsed.data.idea,
      format: parsed.data.format,
      platforms: parsed.data.platforms,
      targetDurationSec: parsed.data.duration,
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        description: a.description,
        durationSec: a.durationSec,
      })),
    });
    await db()
      .update(schema.projects)
      .set({
        script,
        name: script.title.slice(0, 60),
        caption: script.caption,
        hashtags: script.hashtags.join(" "),
        status: "prompteur",
      })
      .where(eq(schema.projects.id, projectId));
  } catch (err) {
    return { error: aiError(err) };
  }
  redirect(`/app/projets/${projectId}/prompteur`);
}

export async function saveScript(projectId: string, text: string): Promise<ActionState> {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  if (!p.script) return { error: "Aucun script à modifier." };
  if (text.trim().length < 5) return { error: "Le script est vide." };
  if (text.length > 6000) return { error: "Le script est trop long." };
  const script = scriptFromEditorText(p.script, text);
  await db().update(schema.projects).set({ script }).where(eq(schema.projects.id, p.id));
  revalidatePath(`/app/projets/${p.id}/prompteur`);
  return { ok: "Script enregistré." };
}

export async function selectTake(projectId: string, takeId: string) {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  const [take] = await db()
    .select()
    .from(schema.takes)
    .where(and(eq(schema.takes.id, takeId), eq(schema.takes.projectId, p.id)));
  if (!take) return;
  await db().update(schema.projects).set({ selectedTakeId: take.id }).where(eq(schema.projects.id, p.id));
  revalidatePath(`/app/projets/${p.id}/prompteur`);
}

export async function deleteTake(projectId: string, takeId: string) {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  const [take] = await db()
    .delete(schema.takes)
    .where(and(eq(schema.takes.id, takeId), eq(schema.takes.projectId, p.id)))
    .returning();
  if (take) {
    await storage()
      .delete(take.storageKey)
      .catch(() => undefined);
    if (p.selectedTakeId === take.id) {
      await db().update(schema.projects).set({ selectedTakeId: null }).where(eq(schema.projects.id, p.id));
    }
  }
  revalidatePath(`/app/projets/${p.id}/prompteur`);
}

async function queueMontage(
  projectId: string,
  data: { instruction?: string; sceneId?: string },
): Promise<ActionState> {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  if (!p.selectedTakeId) return { error: "Retiens d'abord une prise au prompteur." };
  if (p.renderStatus === "queued" || p.renderStatus === "running")
    return { error: "Un montage est déjà en cours." };
  if (!p.countedAt) {
    const u = await usage(user);
    if (u.used >= u.limit) {
      return {
        error: `Tu as utilisé tes ${u.limit} vidéos du mois. Passe à l'offre Créateur ou attends le mois prochain.`,
      };
    }
  }
  await db()
    .update(schema.projects)
    .set({
      status:
        p.status === "prompteur" || p.status === "script" || p.status === "draft" ? "montage" : p.status,
      renderStatus: "queued",
      renderProgress: 0,
      renderMessage: "En attente",
      countedAt: p.countedAt ?? new Date(),
    })
    .where(eq(schema.projects.id, p.id));
  await enqueue(QUEUES.montage, { projectId: p.id, ...data }, { singletonKey: p.id });
  return undefined;
}

export async function startMontage(projectId: string): Promise<ActionState> {
  const res = await queueMontage(projectId, {});
  if (res?.error) return res;
  redirect(`/app/projets/${projectId}/montage`);
}

export async function redoPart(
  projectId: string,
  sceneId: string,
  instruction: string,
): Promise<ActionState> {
  const res = await queueMontage(projectId, {
    sceneId: sceneId.split(".")[0],
    instruction: instruction.slice(0, 500) || "Propose un autre plan pour cette partie.",
  });
  revalidatePath(`/app/projets/${projectId}/montage`);
  return res;
}

export async function correctMontage(_prev: ActionState, form: FormData): Promise<ActionState> {
  const projectId = String(form.get("projectId"));
  const instruction = String(form.get("instruction") ?? "").trim();
  if (instruction.length < 3) return { error: "Dis ce que tu veux changer." };
  const res = await queueMontage(projectId, { instruction: instruction.slice(0, 500) });
  revalidatePath(`/app/projets/${projectId}/montage`);
  return res ?? { ok: "Correction lancée." };
}

export async function acknowledgeWarning(projectId: string, key: string) {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  await db()
    .update(schema.projects)
    .set({
      acknowledgedWarnings: sql`array_append(${schema.projects.acknowledgedWarnings}, ${key.slice(0, 200)})`,
    })
    .where(eq(schema.projects.id, p.id));
  revalidatePath(`/app/projets/${p.id}/montage`);
}

export async function deleteProject(projectId: string) {
  const user = await requireUser();
  const p = await ownedProject(user.id, projectId);
  const takes = await db().select().from(schema.takes).where(eq(schema.takes.projectId, p.id));
  await db().delete(schema.projects).where(eq(schema.projects.id, p.id));
  for (const key of [
    ...takes.map((t) => t.storageKey),
    p.renderKey,
    p.renderKey ? `${p.renderKey}.jpg` : null,
  ]) {
    if (key)
      await storage()
        .delete(key)
        .catch(() => undefined);
  }
  redirect("/app");
}
