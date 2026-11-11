import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq, max } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { apiUser, BadContentError, json, limitedBody, sameOrigin, TooLargeError } from "@/lib/http";
import { mediaDuration } from "@/lib/media";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
};

/** Enregistrement d'une prise au prompteur. Le corps de la requête est l'enregistrement brut. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Origine refusée." }, 403);
  const user = await apiUser(req);
  if (!user) return json({ error: "Connecte-toi." }, 401);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Introuvable" }, 404);
  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return json({ error: "Introuvable" }, 404);

  const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const ext = TYPES[mime];
  if (!ext) return json({ error: "Format d'enregistrement non pris en charge." }, 415);
  const url = new URL(req.url);
  const stoppedAtLine = Number(url.searchParams.get("ligne") ?? "") || null;
  const complete = url.searchParams.get("complete") === "1";

  const dir = await mkdtemp(path.join(tmpdir(), "take-"));
  const file = path.join(dir, `take.${ext}`);
  try {
    const body = limitedBody(req, 300 * 1024 * 1024, (head) => {
      const ascii = head.subarray(0, 12).toString("latin1");
      return (
        head.subarray(0, 4).toString("hex") === "1a45dfa3" ||
        ascii.startsWith("OggS") ||
        ascii.slice(4, 8) === "ftyp"
      );
    });
    await pipeline(body.stream, createWriteStream(file));
    const durationSec = await mediaDuration(file);
    if (durationSec < 1) return json({ error: "Enregistrement trop court ou vide." }, 422);
    if (durationSec > 300) return json({ error: "Enregistrement trop long (5 minutes au plus)." }, 422);

    const takeId = randomUUID();
    const key = `u/${user.id}/takes/${project.id}/${takeId}.${ext}`;
    await storage().put(key, createReadStream(file), mime);
    const [{ n } = { n: 0 }] = await db()
      .select({ n: max(schema.takes.number) })
      .from(schema.takes)
      .where(eq(schema.takes.projectId, project.id));
    const [take] = await db()
      .insert(schema.takes)
      .values({
        id: takeId,
        projectId: project.id,
        number: (n ?? 0) + 1,
        storageKey: key,
        mime,
        durationSec,
        stoppedAtLine,
        complete,
      })
      .returning();
    // Une prise complète devient la prise retenue par défaut.
    if (complete || !project.selectedTakeId) {
      await db()
        .update(schema.projects)
        .set({ selectedTakeId: takeId })
        .where(eq(schema.projects.id, project.id));
    }
    return json({ take }, 201);
  } catch (err) {
    if (err instanceof TooLargeError) return json({ error: "Enregistrement trop lourd." }, 413);
    if (err instanceof BadContentError) return json({ error: err.message }, 415);
    console.error("[take]", err);
    return json({ error: "Enregistrement impossible. Réessaie." }, 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
