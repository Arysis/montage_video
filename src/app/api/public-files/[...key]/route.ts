import { serveObject } from "@/lib/http/serve";
import { verifySignedKey } from "@/lib/storage";

export const runtime = "nodejs";

/** Lien signé et temporaire, pour que les plateformes de publication récupèrent la vidéo. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  if (!verifySignedKey(key, Number(url.searchParams.get("e")), url.searchParams.get("s") ?? "")) {
    return new Response("Lien expiré", { status: 403 });
  }
  return serveObject(req, key);
}
