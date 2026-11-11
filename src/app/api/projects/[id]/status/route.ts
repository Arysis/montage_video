import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { apiUser, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser(req);
  if (!user) return json({ error: "Connecte-toi." }, 401);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Introuvable" }, 404);
  const [p] = await db()
    .select({
      renderStatus: schema.projects.renderStatus,
      renderProgress: schema.projects.renderProgress,
      renderMessage: schema.projects.renderMessage,
      planVersion: schema.projects.planVersion,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!p) return json({ error: "Introuvable" }, 404);
  return json(p);
}
