import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publisher } from "@/lib/publish";
import type { Platform } from "@/lib/qc/rules";
import { blocksPublication } from "@/lib/qc/types";
import { storage } from "@/lib/storage";

/** Envoie une publication aux plateformes. Refuse si le contrôle qualité a un test rouge. */
export async function runPublish(publicationId: string): Promise<void> {
  const [pub] = await db()
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.id, publicationId));
  if (!pub || pub.status === "published") return;
  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, pub.projectId));
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, pub.userId));
  if (!project || !user) return;
  const fail = async (error: string) => {
    await db()
      .update(schema.publications)
      .set({ status: "failed", error })
      .where(eq(schema.publications.id, pub.id));
  };
  if (!project.renderKey || blocksPublication(project.qcReport))
    return fail("Le contrôle qualité bloque la publication.");
  if (!user.publishProfileKey) return fail("Aucun compte relié.");

  await db()
    .update(schema.publications)
    .set({ status: "publishing", error: null })
    .where(eq(schema.publications.id, pub.id));
  try {
    const videoUrl = await storage().publicUrl(project.renderKey, 7 * 24 * 3600);
    const caption = [pub.caption, pub.hashtags].filter(Boolean).join("\n\n");
    const future = pub.scheduledAt.getTime() > Date.now() + 60_000;
    const ids = await publisher().publish({
      profileKey: user.publishProfileKey,
      platforms: pub.platforms as Platform[],
      caption,
      videoUrl,
      scheduledAt: future ? pub.scheduledAt : null,
    });
    await db()
      .update(schema.publications)
      .set({ status: future ? "scheduled" : "published", externalIds: ids })
      .where(eq(schema.publications.id, pub.id));
    await db()
      .update(schema.projects)
      .set({ status: future ? "scheduled" : "published" })
      .where(eq(schema.projects.id, project.id));
  } catch (err) {
    await fail(err instanceof Error ? err.message.slice(0, 500) : "Erreur inconnue");
    throw err;
  }
}
