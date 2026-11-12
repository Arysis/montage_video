import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Prompter } from "@/components/Prompter";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { needsScriptValidation, ownedProject } from "@/lib/projects";
import { scriptToLines } from "@/lib/script/schema";

export const metadata: Metadata = { title: "Prompteur" };

export default async function PrompterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await ownedProject(user.id, id);
  if (!p.script) redirect(`/app/projets/${p.id}/idee`);
  if (needsScriptValidation(p)) redirect(`/app/projets/${p.id}/script`);
  const takes = await db()
    .select()
    .from(schema.takes)
    .where(eq(schema.takes.projectId, p.id))
    .orderBy(asc(schema.takes.number));
  return (
    <Prompter
      projectId={p.id}
      projectName={p.name}
      lines={scriptToLines(p.script).map((l) => l.text)}
      selectedTakeId={p.selectedTakeId}
      montageStarted={p.renderStatus !== "idle"}
      takes={takes.map((t) => ({
        id: t.id,
        number: t.number,
        durationSec: t.durationSec,
        stoppedAtLine: t.stoppedAtLine,
        complete: t.complete,
        storageKey: t.storageKey,
      }))}
    />
  );
}
