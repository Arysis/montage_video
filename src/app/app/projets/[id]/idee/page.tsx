import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { NewVideoForm } from "@/components/NewVideoForm";
import { TopBar } from "@/components/TopBar";
import { requireUser } from "@/lib/auth/session";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import { ownedProject, projectAssets } from "@/lib/projects";

export const metadata: Metadata = { title: "Idée et fichiers" };

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await ownedProject(user.id, id);
  const library = (await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id)))
    .filter((a) => a.kind !== "voice")
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
  const linked = (await projectAssets(p.id)).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
  const [kit] = await db().select().from(schema.brandKits).where(eq(schema.brandKits.userId, user.id));
  return (
    <>
      <TopBar eyebrow={`${p.name} · Étape 1 sur 5`} title="Idée et fichiers" />
      <NewVideoForm
        library={library}
        maxDurationSec={planLimits(user.plan).maxDurationSec}
        brandKitApplied={!!kit && (kit.colors.length > 0 || !!kit.logoAssetId)}
        regenerate={!!p.script}
        initial={{
          projectId: p.id,
          idea: p.idea,
          format: p.format,
          platforms: p.platforms,
          duration: p.targetDurationSec,
          structure: p.script?.structure ?? "auto",
          tone: p.script?.tone ?? "auto",
          assets: linked,
        }}
      />
    </>
  );
}
