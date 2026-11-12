import { Readable } from "node:stream";
import { storage } from "@/lib/storage";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  aac: "audio/aac",
  mov: "video/quicktime",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Sert un fichier du stockage, avec les requêtes partielles (Range) nécessaires à la lecture vidéo. */
export async function serveObject(
  req: Request,
  key: string,
  opts: { download?: string } = {},
): Promise<Response> {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const range = req.headers.get("range")?.match(/bytes=(\d+)-(\d*)/);
  try {
    const obj = await storage().get(
      key,
      range ? { start: Number(range[1]), end: range[2] ? Number(range[2]) : undefined } : undefined,
    );
    const headers = new Headers({
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(obj.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // Un SVG importé ne doit jamais exécuter de script dans notre domaine.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (obj.contentRange) headers.set("Content-Range", obj.contentRange);
    if (opts.download)
      headers.set("Content-Disposition", `attachment; filename="${opts.download.replace(/"/g, "")}"`);
    return new Response(Readable.toWeb(obj.body) as ReadableStream, { status: obj.status, headers });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
