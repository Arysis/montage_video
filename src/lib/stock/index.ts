import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import type { Asset } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { Script } from "@/lib/script/schema";
import { storage } from "@/lib/storage";

/**
 * Banques d'images et de vidéos libres de droits : quand le créateur n'a pas fourni de fichier
 * pour une scène, on cherche un plan qui illustre ce qui est dit. Aucun jeton d'IA : le mot-clé
 * de recherche est déjà dans le script.
 */

export type Orientation = "portrait" | "landscape" | "square";

export type StockItem = {
  source: "pexels" | "pixabay" | "openverse";
  id: string;
  kind: "video" | "image";
  url: string;
  width: number;
  height: number;
  durationSec: number | null;
  credit: string;
};

export interface StockProvider {
  readonly name: StockItem["source"];
  search(query: string, orientation: Orientation): Promise<StockItem[]>;
}

const TIMEOUT = 10_000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "montage-video/1.0", ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} : ${res.status}`);
  return res.json();
}

const ratioOf = (o: Orientation) => (o === "portrait" ? 9 / 16 : o === "landscape" ? 16 / 9 : 1);
/** Le cadre du fichier est-il proche de celui de la vidéo ? */
export const fits = (w: number, h: number, o: Orientation) => {
  const r = w / h / ratioOf(o);
  return r > 0.6 && r < 1.6;
};

type PexelsVideoFile = { link: string; width: number; height: number; file_type: string };
type PexelsVideos = {
  videos?: { id: number; duration: number; user?: { name?: string }; video_files: PexelsVideoFile[] }[];
};
type PexelsPhotos = {
  photos?: {
    id: number;
    width: number;
    height: number;
    photographer?: string;
    src: Record<string, string>;
  }[];
};

/** Le fichier vidéo le plus léger qui reste net (720 px au moins sur le petit côté). */
export function pickVideoFile<T extends { width: number; height: number }>(files: T[]): T | undefined {
  const sorted = [...files]
    .filter((f) => f.width && f.height)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.find((f) => Math.min(f.width, f.height) >= 720) ?? sorted[sorted.length - 1];
}

export class PexelsProvider implements StockProvider {
  readonly name = "pexels";
  constructor(private key: string) {}

  async search(query: string, orientation: Orientation): Promise<StockItem[]> {
    // Pexels comprend le français si on le lui dit (scripts écrits avant les mots-clés anglais).
    const q = `${encodeURIComponent(query)}${looksFrench(query) ? "&locale=fr-FR" : ""}`;
    const headers = { Authorization: this.key };
    const items: StockItem[] = [];
    const videos = (await getJson(
      `https://api.pexels.com/videos/search?query=${q}&orientation=${orientation}&per_page=8&size=medium`,
      headers,
    )) as PexelsVideos;
    for (const v of videos.videos ?? []) {
      const file = pickVideoFile(v.video_files.filter((f) => f.file_type === "video/mp4"));
      if (file && fits(file.width, file.height, orientation)) {
        items.push({
          source: "pexels",
          id: String(v.id),
          kind: "video",
          url: file.link,
          width: file.width,
          height: file.height,
          durationSec: v.duration,
          credit: v.user?.name ?? "Pexels",
        });
      }
    }
    if (items.length < 2) {
      const photos = (await getJson(
        `https://api.pexels.com/v1/search?query=${q}&orientation=${orientation}&per_page=6`,
        headers,
      )) as PexelsPhotos;
      for (const p of photos.photos ?? []) {
        const url = p.src.large2x ?? p.src.original;
        if (url)
          items.push({
            source: "pexels",
            id: `p${p.id}`,
            kind: "image",
            url,
            width: p.width,
            height: p.height,
            durationSec: null,
            credit: p.photographer ?? "Pexels",
          });
      }
    }
    return items;
  }
}

type PixabayVideos = {
  hits?: {
    id: number;
    duration: number;
    user?: string;
    videos: Record<string, { url: string; width: number; height: number }>;
  }[];
};
type PixabayImages = {
  hits?: { id: number; largeImageURL: string; imageWidth: number; imageHeight: number; user?: string }[];
};

export class PixabayProvider implements StockProvider {
  readonly name = "pixabay";
  constructor(private key: string) {}

  async search(query: string, orientation: Orientation): Promise<StockItem[]> {
    const q = encodeURIComponent(query.slice(0, 90));
    const items: StockItem[] = [];
    const videos = (await getJson(
      `https://pixabay.com/api/videos/?key=${this.key}&q=${q}&per_page=10&safesearch=true`,
    )) as PixabayVideos;
    for (const v of videos.hits ?? []) {
      const file = pickVideoFile(Object.values(v.videos).filter((f) => f.url));
      if (file && fits(file.width, file.height, orientation))
        items.push({
          source: "pixabay",
          id: String(v.id),
          kind: "video",
          url: file.url,
          width: file.width,
          height: file.height,
          durationSec: v.duration,
          credit: v.user ?? "Pixabay",
        });
    }
    if (items.length < 2) {
      const pixOrientation =
        orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all";
      const images = (await getJson(
        `https://pixabay.com/api/?key=${this.key}&q=${q}&image_type=photo&orientation=${pixOrientation}&per_page=6&safesearch=true`,
      )) as PixabayImages;
      for (const p of images.hits ?? [])
        items.push({
          source: "pixabay",
          id: `p${p.id}`,
          kind: "image",
          url: p.largeImageURL,
          width: p.imageWidth,
          height: p.imageHeight,
          durationSec: null,
          credit: p.user ?? "Pixabay",
        });
    }
    return items;
  }
}

type OpenverseImages = {
  results?: {
    id: string;
    url: string;
    width: number | null;
    height: number | null;
    creator?: string | null;
  }[];
};

/** Openverse : photos du domaine public (CC0), sans clé ni mention obligatoire. Repli gratuit. */
export class OpenverseProvider implements StockProvider {
  readonly name = "openverse";

  async search(query: string, orientation: Orientation): Promise<StockItem[]> {
    const aspect = orientation === "portrait" ? "tall" : orientation === "landscape" ? "wide" : "square";
    const res = (await getJson(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0,pdm&aspect_ratio=${aspect}&mature=false&page_size=8`,
    )) as OpenverseImages;
    return (res.results ?? [])
      .filter((r) => r.url && (r.width ?? 0) >= 600 && (r.height ?? 0) >= 600)
      .map((r) => ({
        source: "openverse" as const,
        id: r.id,
        kind: "image" as const,
        url: r.url,
        width: r.width!,
        height: r.height!,
        durationSec: null,
        credit: r.creator ?? "Openverse",
      }));
  }
}

/** Banques actives, dans l'ordre de préférence (vidéos Pexels d'abord). */
export function stockProviders(): StockProvider[] {
  const e = env();
  const wanted = e.STOCK_PROVIDERS.split(",").map((s) => s.trim());
  const list: StockProvider[] = [];
  for (const name of wanted) {
    if (name === "pexels" && e.PEXELS_API_KEY) list.push(new PexelsProvider(e.PEXELS_API_KEY));
    if (name === "pixabay" && e.PIXABAY_API_KEY) list.push(new PixabayProvider(e.PIXABAY_API_KEY));
    if (name === "openverse") list.push(new OpenverseProvider());
  }
  return list;
}

export const looksFrench = (q: string) =>
  /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|un|une|des|du|sur|avec|qui|dans|ton|ta|tes)\b/i.test(q);

const GENERIC = /^(plan|scène|scene)\b.*(illustre|accroche)|^plan qui/i;

/** Ce qu'on cherche pour une scène : le mot-clé du script, sinon ce qu'on voit, sinon le texte. */
export function sceneQuery(scene: Script["scenes"][number]): string {
  if (scene.search?.trim()) return scene.search.trim();
  if (scene.visualIntent && !GENERIC.test(scene.visualIntent)) return scene.visualIntent.slice(0, 80);
  return scene.text.split(/\s+/).slice(0, 8).join(" ");
}

export const assetNameFor = (item: StockItem) =>
  `${item.source}-${item.id}${item.kind === "video" ? ".mp4" : ".jpg"}`;

async function download(url: string, file: string, maxBytes: number) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "montage-video/1.0" },
  });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      cb(size > maxBytes ? new Error("Fichier trop lourd") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(file));
}

/** Télécharge un résultat et l'ajoute à la bibliothèque du créateur (réutilisable, supprimable). */
export async function importStockItem(
  userId: string,
  item: StockItem,
  query: string,
  work: string,
): Promise<Asset> {
  const name = assetNameFor(item);
  const [existing] = await db()
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.userId, userId), eq(schema.assets.name, name)));
  if (existing) return existing;
  await mkdir(work, { recursive: true });
  const raw = path.join(work, `stock-${item.source}-${item.id}`);
  try {
    await download(item.url, raw, 80 * 1024 * 1024);
    let body: Buffer;
    let width = item.width;
    let height = item.height;
    let mime = "video/mp4";
    if (item.kind === "image") {
      // Les photos des banques sont souvent énormes : 2160 px suffisent pour une vidéo.
      const out = await sharp(raw).rotate().resize(2160, 2160, { fit: "inside", withoutEnlargement: true });
      body = await out.jpeg({ quality: 86 }).toBuffer();
      const meta = await sharp(body).metadata();
      width = meta.width ?? width;
      height = meta.height ?? height;
      mime = "image/jpeg";
    } else {
      body = await readFile(raw);
    }
    const id = crypto.randomUUID();
    const key = `u/${userId}/assets/${id}/${name}`;
    await storage().put(key, body, mime);
    const thumbKey = item.kind === "image" ? `${key}.thumb.jpg` : null;
    if (thumbKey) {
      await storage().put(
        thumbKey,
        await sharp(body).resize(640, 640, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
        "image/jpeg",
      );
    }
    const [asset] = await db()
      .insert(schema.assets)
      .values({
        id,
        userId,
        kind: item.kind,
        name,
        mime,
        sizeBytes: (await stat(raw)).size,
        storageKey: key,
        rights: "free",
        durationSec: item.durationSec,
        width,
        height,
        thumbKey,
        description: `Banque libre (${item.source}, ${item.credit}) : ${query}`.slice(0, 300),
        analyzedAt: new Date(),
      })
      .returning();
    return asset!;
  } finally {
    await rm(raw, { force: true });
  }
}

/** Cherche dans les banques, dans l'ordre, et renvoie les meilleurs résultats encore inutilisés. */
export async function findStock(
  providers: StockProvider[],
  query: string,
  orientation: Orientation,
  used: Set<string>,
  count: number,
): Promise<StockItem[]> {
  for (const p of providers) {
    try {
      const items = (await p.search(query, orientation)).filter((i) => !used.has(assetNameFor(i)));
      // Les vidéos d'abord : elles donnent plus de vie que les photos.
      items.sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video"));
      if (items.length) return items.slice(0, count);
    } catch (err) {
      console.error("[stock]", p.name, err instanceof Error ? err.message : err);
    }
  }
  return [];
}

/**
 * Illustre les scènes du script qui n'ont aucun fichier : une à deux vidéos ou photos libres
 * de droits par scène, ajoutées à la bibliothèque et au script (le créateur peut les retirer).
 */
export async function illustrateScript(opts: {
  userId: string;
  script: Script;
  orientation: Orientation;
  work: string;
  providers?: StockProvider[];
}): Promise<{ script: Script; added: Asset[] }> {
  const providers = opts.providers ?? stockProviders();
  if (!providers.length) return { script: opts.script, added: [] };
  const added: Asset[] = [];
  const used = new Set<string>();
  const scenes = [];
  for (const scene of opts.script.scenes) {
    if (scene.visuals.length) {
      scenes.push(scene);
      continue;
    }
    const query = sceneQuery(scene);
    const words = scene.text.split(/\s+/).length;
    const items = await findStock(providers, query, opts.orientation, used, words > 14 ? 2 : 1);
    const ids: string[] = [];
    for (const item of items) {
      used.add(assetNameFor(item));
      try {
        const asset = await importStockItem(opts.userId, item, query, opts.work);
        added.push(asset);
        ids.push(asset.id);
      } catch (err) {
        console.error("[stock] import", item.source, item.id, err instanceof Error ? err.message : err);
      }
    }
    scenes.push(ids.length ? { ...scene, visuals: ids } : scene);
  }
  return { script: { ...opts.script, scenes }, added };
}
