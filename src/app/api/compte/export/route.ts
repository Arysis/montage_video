import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { apiUser, json } from "@/lib/http";

export const runtime = "nodejs";

/** Export de toutes les données du compte (droit à la portabilité). Les fichiers se téléchargent via les liens fournis. */
export async function GET(req: Request) {
  const user = await apiUser(req);
  if (!user) return json({ error: "Connecte-toi." }, 401);
  const origin = new URL(req.url).origin;
  const file = (key: string | null) => (key ? `${origin}/api/files/${key}?telecharger=1` : null);

  const [kit] = await db().select().from(schema.brandKits).where(eq(schema.brandKits.userId, user.id));
  const assets = await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id));
  const projects = await db().select().from(schema.projects).where(eq(schema.projects.userId, user.id));
  const ids = projects.map((p) => p.id);
  const takes = ids.length
    ? await db().select().from(schema.takes).where(inArray(schema.takes.projectId, ids))
    : [];
  const publications = await db()
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.userId, user.id));

  const data = {
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      firstName: user.firstName,
      plan: user.plan,
      createdAt: user.createdAt,
    },
    brandKit: kit ?? null,
    files: assets.map(({ storageKey, thumbKey, renderKey: _r, userId: _u, ...a }) => ({
      ...a,
      download: file(storageKey),
      thumbnail: file(thumbKey),
    })),
    projects: projects.map(({ renderKey, userId: _u, ...p }) => ({
      ...p,
      video: file(renderKey),
      takes: takes
        .filter((t) => t.projectId === p.id)
        .map(({ storageKey, ...t }) => ({ ...t, download: file(storageKey) })),
    })),
    publications: publications.map(({ userId: _u, ...p }) => p),
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mes-donnees-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
