import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScriptEditor } from "@/components/ScriptEditor";
import { requireUser } from "@/lib/auth/session";
import { groupCharacters, groupOf, mainCharacterImages } from "@/lib/character/poses";
import { db, schema } from "@/lib/db";
import { ownedProject } from "@/lib/projects";
import { normalizeScript } from "@/lib/script/schema";

export const metadata: Metadata = { title: "Script" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await ownedProject(user.id, id);
  if (!p.script) redirect(`/app/projets/${p.id}/idee`);
  const all = await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id));
  const groups = groupCharacters(all);
  const files = mainCharacterImages(all)
    .filter((a) => ["video", "image", "character", "music"].includes(a.kind))
    .map((a) => ({
      id: a.id,
      name: a.kind === "character" ? (groupOf(groups, a.id)?.name ?? a.name) : a.name,
      kind: a.kind,
    }));
  const [takes] = await db()
    .select({ n: count() })
    .from(schema.takes)
    .where(eq(schema.takes.projectId, p.id));
  return (
    <ScriptEditor
      projectId={p.id}
      projectName={p.name}
      script={normalizeScript(p.script)}
      files={files}
      targetDurationSec={p.targetDurationSec}
      hasTakes={(takes?.n ?? 0) > 0}
    />
  );
}
