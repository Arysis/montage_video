import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { classifyUpload, sniffMatches } from "@/lib/assets";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { apiUser, BadContentError, json, limitedBody, sameOrigin, TooLargeError } from "@/lib/http";
import { enqueue, QUEUES } from "@/lib/jobs";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const KINDS = ["logo", "character", "video", "image", "music", "font"] as const;

/** Import d'un fichier dans la bibliothèque. Le corps de la requête est le fichier brut. */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origine refusée." }, 403);
  const user = await apiUser(req);
  if (!user) return json({ error: "Connecte-toi." }, 401);

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").slice(0, 120);
  const detected = classifyUpload(name);
  if (!detected) return json({ error: "Format non pris en charge." }, 415);
  const requested = url.searchParams.get("kind");
  let kind: (typeof KINDS)[number] = detected.kind;
  if (requested && (KINDS as readonly string[]).includes(requested)) {
    const k = requested as (typeof KINDS)[number];
    // Le type demandé doit rester cohérent avec le fichier (une image peut être logo, personnage ou image).
    const imageKinds = ["logo", "character", "image"];
    if (k === detected.kind || (imageKinds.includes(k) && imageKinds.includes(detected.kind))) kind = k;
  }
  const rights = url.searchParams.get("rights");

  const id = randomUUID();
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "fichier";
  const key = `u/${user.id}/assets/${id}/${safeName}`;
  try {
    const body = limitedBody(req, env().MAX_UPLOAD_MB * 1024 * 1024, (head) =>
      sniffMatches(detected.mime, head),
    );
    const size = await storage().put(key, body.stream, detected.mime);
    const [asset] = await db()
      .insert(schema.assets)
      .values({
        id,
        userId: user.id,
        kind,
        name,
        mime: detected.mime,
        sizeBytes: size,
        storageKey: key,
        rights: rights === "licensed" || rights === "free" || rights === "unknown" ? rights : "own",
      })
      .returning();
    await enqueue(QUEUES.analyzeAsset, { assetId: id });
    return json({ asset }, 201);
  } catch (err) {
    await storage()
      .delete(key)
      .catch(() => undefined);
    if (err instanceof TooLargeError)
      return json({ error: `Fichier trop lourd (${env().MAX_UPLOAD_MB} Mo au plus).` }, 413);
    if (err instanceof BadContentError) return json({ error: err.message }, 415);
    console.error("[upload]", err);
    return json({ error: "Import impossible. Réessaie." }, 500);
  }
}

export async function GET(req: Request) {
  const user = await apiUser(req);
  if (!user) return json({ error: "Connecte-toi." }, 401);
  const assets = await db().select().from(schema.assets).where(eq(schema.assets.userId, user.id));
  return json({ assets: assets.filter((a) => a.kind !== "voice") });
}
