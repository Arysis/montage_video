import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { NewVideoForm } from "@/components/NewVideoForm";
import { TopBar } from "@/components/TopBar";
import { requireUser } from "@/lib/auth/session";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Nouvelle vidéo" };

export default async function NewVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ fichier?: string }>;
}) {
  const user = await requireUser();
  const { fichier } = await searchParams;
  const library = (await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id)))
    .filter((a) => a.kind !== "voice")
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
  const [kit] = await db().select().from(schema.brandKits).where(eq(schema.brandKits.userId, user.id));
  const preselected = library.filter((a) => a.id === fichier);
  return (
    <>
      <TopBar eyebrow="Étape 1 sur 5" title="Nouvelle vidéo" />
      <NewVideoForm
        library={library}
        preselected={preselected}
        maxDurationSec={planLimits(user.plan).maxDurationSec}
        brandKitApplied={!!kit && (kit.colors.length > 0 || !!kit.logoAssetId)}
      />
    </>
  );
}
