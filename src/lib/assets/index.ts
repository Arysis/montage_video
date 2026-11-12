import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { ai } from "@/lib/ai";
import { db, schema } from "@/lib/db";
import type { Asset } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { probe } from "@/lib/qc/post-render";
import { run } from "@/lib/render/ffmpeg";
import { storage } from "@/lib/storage";

export type AssetKind = Asset["kind"];

export const ASSET_KIND_LABELS: Record<Exclude<AssetKind, "voice">, string> = {
  logo: "Logo",
  character: "Personnage",
  video: "Vidéo",
  image: "Image",
  music: "Musique",
  font: "Police",
};

export const LIBRARY_TABS: { kind: Exclude<AssetKind, "voice"> | "all"; label: string }[] = [
  { kind: "all", label: "Tout" },
  { kind: "logo", label: "Logos" },
  { kind: "character", label: "Personnages" },
  { kind: "video", label: "Vidéos" },
  { kind: "image", label: "Images" },
  { kind: "music", label: "Musiques" },
  { kind: "font", label: "Polices" },
];

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  ttf: "font/ttf",
  otf: "font/otf",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXT_MIME);

/** Déduit le type MIME (on ne fait pas confiance au navigateur) et le type d'asset. */
export function classifyUpload(fileName: string): { mime: string; kind: Exclude<AssetKind, "voice"> } | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_MIME[ext];
  if (!mime) return null;
  const lower = fileName.toLowerCase();
  if (mime.startsWith("video/")) return { mime, kind: "video" };
  if (mime.startsWith("audio/")) return { mime, kind: "music" };
  if (mime.startsWith("font/")) return { mime, kind: "font" };
  if (/logo/.test(lower) || mime === "image/svg+xml") return { mime, kind: "logo" };
  if (/(mascotte|personnage|character|avatar)/.test(lower)) return { mime, kind: "character" };
  return { mime, kind: "image" };
}

/** Vérifie les premiers octets du fichier pour refuser un contenu déguisé. */
export function sniffMatches(mime: string, head: Buffer): boolean {
  const hex = head.subarray(0, 12).toString("hex");
  const ascii = head.subarray(0, 64).toString("latin1");
  if (mime === "image/png") return hex.startsWith("89504e47");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mime === "image/svg+xml") return /<svg|<\?xml/i.test(head.subarray(0, 512).toString("utf8"));
  if (mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4")
    return ascii.slice(4, 8) === "ftyp";
  if (mime === "video/webm") return hex.startsWith("1a45dfa3");
  if (mime === "audio/mpeg") return ascii.startsWith("ID3") || hex.startsWith("fff") || hex.startsWith("ffe");
  if (mime === "audio/wav") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
  if (mime === "audio/ogg") return ascii.startsWith("OggS");
  if (mime === "audio/aac") return hex.startsWith("fff");
  if (mime === "font/ttf") return hex.startsWith("00010000") || ascii.startsWith("true");
  if (mime === "font/otf") return ascii.startsWith("OTTO");
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} Go`;
}

export function extensionLabel(asset: Pick<Asset, "name">): string {
  return (asset.name.split(".").pop() ?? "").toUpperCase();
}

/**
 * Analyse un fichier importé : durée, dimensions, vignette, conversion pour le rendu
 * et description par l'IA (pour qu'elle sache quand l'utiliser).
 */
export async function analyzeAsset(assetId: string): Promise<void> {
  const [asset] = await db().select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset) return;
  const e = env();
  const dir = await mkdtemp(path.join(tmpdir(), "asset-"));
  try {
    const src = path.join(dir, `src.${asset.name.split(".").pop()}`);
    await storage().download(asset.storageKey, src);
    const update: Partial<Asset> = { analyzedAt: new Date() };
    let jpeg: Buffer | null = null;

    if (asset.mime.startsWith("image/")) {
      const img = sharp(src, { density: 300 });
      const meta = await img.metadata();
      update.width = meta.width ?? null;
      update.height = meta.height ?? null;
      jpeg = await sharp(src, { density: 300 })
        .resize(640, 640, { fit: "inside" })
        .flatten({ background: "#1F2226" })
        .jpeg({ quality: 80 })
        .toBuffer();
      // FFmpeg ne lit pas le SVG : on en garde une version PNG transparente.
      if (asset.mime === "image/svg+xml") {
        const png = await sharp(src, { density: 300 }).resize(1200, 1200, { fit: "inside" }).png().toBuffer();
        update.renderKey = `${asset.storageKey}.png`;
        await storage().put(update.renderKey, png, "image/png");
      }
    } else if (asset.mime.startsWith("video/")) {
      const p = await probe(e.FFPROBE_PATH, src);
      update.durationSec = p.durationSec;
      update.width = p.video?.width ?? null;
      update.height = p.video?.height ?? null;
      const frame = path.join(dir, "frame.jpg");
      await run(e.FFMPEG_PATH, [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        String(Math.min(1, p.durationSec / 2)),
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:640:force_original_aspect_ratio=decrease",
        "-q:v",
        "4",
        frame,
      ]);
      jpeg = await readFile(frame);
    } else if (asset.mime.startsWith("audio/")) {
      const p = await probe(e.FFPROBE_PATH, src);
      update.durationSec = p.durationSec;
    } else if (asset.mime.startsWith("font/")) {
      const { stdout } = await run("fc-scan", ["--format", "%{family[0]}\n", src]);
      update.fontFamily = stdout.split("\n")[0]?.trim() || null;
    }

    if (jpeg) {
      update.thumbKey = `${asset.storageKey}.thumb.jpg`;
      await storage().put(update.thumbKey, jpeg, "image/jpeg");
      if (asset.kind !== "font") {
        update.description = await ai()
          .describeImage({ jpeg, name: asset.name, kind: asset.kind })
          .catch(() => null);
      }
    }
    await db().update(schema.assets).set(update).where(eq(schema.assets.id, asset.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
