import { apiUser } from "@/lib/http";
import { serveObject } from "@/lib/http/serve";

export const runtime = "nodejs";

/** Fichiers privés : seul le propriétaire (préfixe u/<id>/) peut les lire. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await apiUser(req);
  if (!user) return new Response("Connecte-toi.", { status: 401 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  if (!key.startsWith(`u/${user.id}/`) || key.includes(".."))
    return new Response("Introuvable", { status: 404 });
  const download = new URL(req.url).searchParams.get("telecharger");
  return serveObject(req, key, { download: download ? download.slice(0, 100) : undefined });
}
