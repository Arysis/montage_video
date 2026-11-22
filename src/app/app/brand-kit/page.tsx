// Polices fournies, chargées pour l'aperçu du Brand Kit.
import "@fontsource/anton/400.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/abril-fatface/400.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { BrandKitEditor } from "@/components/BrandKitEditor";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Brand Kit" };

const DEFAULT_COLORS = [
  { name: "Principale", hex: "#FF5A36" },
  { name: "Secondaire", hex: "#3DDC97" },
  { name: "Fond", hex: "#0E0F11" },
  { name: "Texte", hex: "#F2EFE9" },
];

export default async function BrandKitPage() {
  const user = await requireUser();
  const [kit] = await db().select().from(schema.brandKits).where(eq(schema.brandKits.userId, user.id));
  const assets = await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id));
  const images = assets
    .filter((a) => a.kind === "logo" || a.kind === "image" || a.kind === "character")
    .sort((a, b) => Number(b.kind === "logo") - Number(a.kind === "logo"))
    .map((a) => ({ id: a.id, name: a.name, thumbKey: a.thumbKey }));
  const fonts = assets
    .filter((a) => a.kind === "font")
    .map((a) => ({ id: a.id, name: a.name, family: a.fontFamily, storageKey: a.storageKey, mime: a.mime }));
  return (
    <BrandKitEditor
      images={images}
      fonts={fonts}
      initial={{
        logoAssetId: kit?.logoAssetId ?? null,
        logoDarkAssetId: kit?.logoDarkAssetId ?? null,
        colors: kit?.colors.length ? kit.colors : DEFAULT_COLORS,
        titleFont: kit?.titleFont ?? "Bricolage Grotesque",
        bodyFont: kit?.bodyFont ?? "IBM Plex Sans",
        subtitleStyle: kit?.subtitleStyle ?? "boxed",
        subtitlePosition: kit?.subtitlePosition ?? "bottom",
      }}
    />
  );
}
