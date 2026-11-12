import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Library } from "@/components/Library";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Bibliothèque" };

export default async function LibraryPage() {
  const user = await requireUser();
  const assets = await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id));
  const uses = await db()
    .select({ assetId: schema.projectAssets.assetId, n: count() })
    .from(schema.projectAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.projectAssets.assetId))
    .where(eq(schema.assets.userId, user.id))
    .groupBy(schema.projectAssets.assetId);
  const useMap = new Map(uses.map((u) => [u.assetId, u.n]));
  return (
    <Library
      assets={assets
        .filter((a) => a.kind !== "voice")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind as Exclude<typeof a.kind, "voice">,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          rights: a.rights,
          createdAt: a.createdAt.toISOString(),
          thumbKey: a.thumbKey,
          storageKey: a.storageKey,
          durationSec: a.durationSec,
          fontFamily: a.fontFamily,
          analyzed: !!a.analyzedAt,
          characterName: a.characterName,
          pose: a.pose,
          uses: useMap.get(a.id) ?? 0,
        }))}
    />
  );
}
