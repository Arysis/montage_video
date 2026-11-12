"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

const updateSchema = z.object({
  kind: z.enum(["logo", "character", "video", "image", "music", "font"]).optional(),
  rights: z.enum(["own", "licensed", "free", "unknown"]).optional(),
});

const IMAGE_KINDS = ["logo", "character", "image"];

export async function updateAsset(
  assetId: string,
  input: { kind?: string; rights?: string },
): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(assetId)) return { error: "Valeur invalide." };
  const [asset] = await db()
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.userId, user.id)));
  if (!asset) return { error: "Fichier introuvable." };
  const set: { kind?: typeof asset.kind; rights?: typeof asset.rights } = {};
  if (parsed.data.kind && parsed.data.kind !== asset.kind) {
    // Seules les images peuvent changer de type (logo, personnage, image).
    if (!IMAGE_KINDS.includes(asset.kind) || !IMAGE_KINDS.includes(parsed.data.kind)) {
      return { error: "Ce type ne correspond pas au fichier." };
    }
    set.kind = parsed.data.kind;
  }
  if (parsed.data.rights) set.rights = parsed.data.rights;
  if (Object.keys(set).length)
    await db().update(schema.assets).set(set).where(eq(schema.assets.id, asset.id));
  revalidatePath("/app/bibliotheque");
  return {};
}

export async function deleteAsset(assetId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return { error: "Fichier introuvable." };
  const [asset] = await db()
    .delete(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.userId, user.id)))
    .returning();
  if (!asset) return { error: "Fichier introuvable." };
  // Retirer le logo du Brand Kit s'il pointait sur ce fichier.
  await db()
    .update(schema.brandKits)
    .set({ logoAssetId: null })
    .where(and(eq(schema.brandKits.userId, user.id), eq(schema.brandKits.logoAssetId, asset.id)));
  await db()
    .update(schema.brandKits)
    .set({ logoDarkAssetId: null })
    .where(and(eq(schema.brandKits.userId, user.id), eq(schema.brandKits.logoDarkAssetId, asset.id)));
  for (const key of [asset.storageKey, asset.thumbKey, asset.renderKey]) {
    if (key)
      await storage()
        .delete(key)
        .catch(() => undefined);
  }
  revalidatePath("/app/bibliotheque");
  revalidatePath("/app/brand-kit");
  return {};
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const brandSchema = z.object({
  logoAssetId: z.string().uuid().nullable(),
  logoDarkAssetId: z.string().uuid().nullable(),
  colors: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(30),
        hex: z.string().regex(HEX, "Couleur invalide (#RRGGBB)."),
      }),
    )
    .max(8, "8 couleurs au plus."),
  titleFont: z.string().trim().min(1).max(80),
  bodyFont: z.string().trim().min(1).max(80),
  subtitleStyle: z.enum(["boxed", "outline", "word"]),
  subtitlePosition: z.enum(["bottom", "center"]),
});
export type BrandKitInput = z.infer<typeof brandSchema>;

export async function saveBrandKit(input: BrandKitInput): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const data = parsed.data;
  // Les logos doivent appartenir à l'utilisateur.
  for (const id of [data.logoAssetId, data.logoDarkAssetId]) {
    if (!id) continue;
    const [a] = await db()
      .select({ id: schema.assets.id, kind: schema.assets.kind })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, id), eq(schema.assets.userId, user.id)));
    if (!a || !IMAGE_KINDS.includes(a.kind)) return { error: "Logo introuvable." };
  }
  // Une police importée doit exister dans la bibliothèque, sinon on accepte les polices fournies.
  const builtIn = ["Bricolage Grotesque", "IBM Plex Sans"];
  for (const font of [data.titleFont, data.bodyFont]) {
    if (builtIn.includes(font)) continue;
    const [f] = await db()
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.userId, user.id),
          eq(schema.assets.kind, "font"),
          eq(schema.assets.fontFamily, font),
        ),
      );
    if (!f) return { error: `Police « ${font} » introuvable dans ta bibliothèque.` };
  }
  await db()
    .insert(schema.brandKits)
    .values({ userId: user.id, ...data })
    .onConflictDoUpdate({ target: schema.brandKits.userId, set: { ...data, updatedAt: new Date() } });
  revalidatePath("/app/brand-kit");
  return { ok: "Brand Kit enregistré." };
}
