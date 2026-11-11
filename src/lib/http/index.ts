import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { SESSION_COOKIE, userFromToken } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";

/** Protection CSRF des routes API qui modifient des données : l'origine doit être la nôtre. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function apiUser(req: Request): Promise<User | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return userFromToken(token ? decodeURIComponent(token) : undefined);
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export class TooLargeError extends Error {}
export class BadContentError extends Error {}

/**
 * Transforme le corps de la requête en flux Node, en limitant la taille
 * et en vérifiant les premiers octets (type réel du fichier).
 */
export function limitedBody(
  req: Request,
  maxBytes: number,
  checkHead?: (head: Buffer) => boolean,
): { stream: Readable; bytes: () => number } {
  if (!req.body) throw new BadContentError("Fichier vide.");
  let total = 0;
  let checked = !checkHead;
  let head = Buffer.alloc(0);
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) return cb(new TooLargeError("Fichier trop lourd."));
      if (!checked) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= 512 || total === head.length) {
          checked = true;
          if (!checkHead!(head))
            return cb(new BadContentError("Le contenu du fichier ne correspond pas à son extension."));
        }
      }
      cb(null, chunk);
    },
    flush(cb) {
      if (!checked && checkHead && !checkHead(head)) return cb(new BadContentError("Fichier illisible."));
      cb();
    },
  });
  const source = Readable.fromWeb(req.body as unknown as WebReadableStream<Uint8Array>);
  source.on("error", (e) => guard.destroy(e));
  return { stream: source.pipe(guard), bytes: () => total };
}
