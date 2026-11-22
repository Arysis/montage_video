import { env } from "@/lib/env";
import type { Orientation, StockItem } from "./index";

/**
 * Images créées par une IA quand aucune vraie vidéo ne colle (idée abstraite, métaphore, objet
 * introuvable en banque) ou quand le script le demande. Toutes optionnelles, essayées dans l'ordre :
 * - Cloudflare Workers AI (Flux schnell) : gratuit jusqu'à un quota quotidien, clé + id de compte ;
 * - fal.ai (Flux schnell) : quelques dixièmes de centime par image, clé ;
 * - Pollinations : gratuit, sans clé (plus lent, limité en débit ; jeton facultatif).
 */

export interface ImageGenerator {
  readonly name: "cloudflare" | "fal" | "pollinations";
  generate(prompt: string, orientation: Orientation, seed: number): Promise<StockItem>;
}

const TIMEOUT = 45_000;

/** Consigne de style ajoutée à chaque image : photo crédible, sans texte (illisible chez ces modèles). */
export function imagePrompt(subject: string): string {
  return `${subject.trim().replace(/\s+/g, " ").slice(0, 300)}. Cinematic photo, natural light, sharp focus, rich colors, no text, no letters, no watermark, no logo.`;
}

const sizeFor = (o: Orientation) =>
  o === "portrait"
    ? { width: 768, height: 1344 }
    : o === "landscape"
      ? { width: 1344, height: 768 }
      : { width: 1024, height: 1024 };

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "montage-video/1.0", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} : ${res.status}`);
  return res.json();
}

export class CloudflareGenerator implements ImageGenerator {
  readonly name = "cloudflare";
  constructor(
    private accountId: string,
    private token: string,
  ) {}

  async generate(prompt: string, _orientation: Orientation, seed: number): Promise<StockItem> {
    const out = (await postJson(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      { prompt: imagePrompt(prompt), steps: 6, seed },
      { Authorization: `Bearer ${this.token}` },
    )) as { result?: { image?: string } };
    const b64 = out.result?.image;
    if (!b64) throw new Error("Cloudflare : aucune image");
    // Flux schnell chez Cloudflare sort du 1024 x 1024 : le montage le cadre sur un fond flou.
    return {
      source: "cloudflare",
      id: `${seed}-${hash(prompt)}`,
      kind: "image",
      url: "",
      data: Buffer.from(b64, "base64"),
      width: 1024,
      height: 1024,
      durationSec: null,
      credit: "Image IA (Flux, Cloudflare)",
    };
  }
}

export class FalGenerator implements ImageGenerator {
  readonly name = "fal";
  constructor(private key: string) {}

  async generate(prompt: string, orientation: Orientation, seed: number): Promise<StockItem> {
    const imageSize =
      orientation === "portrait"
        ? "portrait_16_9"
        : orientation === "landscape"
          ? "landscape_16_9"
          : "square_hd";
    const out = (await postJson(
      "https://fal.run/fal-ai/flux/schnell",
      {
        prompt: imagePrompt(prompt),
        image_size: imageSize,
        num_images: 1,
        seed,
        enable_safety_checker: true,
      },
      { Authorization: `Key ${this.key}` },
    )) as { images?: { url: string; width?: number; height?: number }[] };
    const img = out.images?.[0];
    if (!img?.url) throw new Error("fal.ai : aucune image");
    const size = sizeFor(orientation);
    return {
      source: "fal",
      id: `${seed}-${hash(prompt)}`,
      kind: "image",
      url: img.url,
      width: img.width ?? size.width,
      height: img.height ?? size.height,
      durationSec: null,
      credit: "Image IA (Flux, fal.ai)",
    };
  }
}

export class PollinationsGenerator implements ImageGenerator {
  readonly name = "pollinations";
  constructor(private token?: string) {}

  async generate(prompt: string, orientation: Orientation, seed: number): Promise<StockItem> {
    const { width, height } = sizeFor(orientation);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt(prompt))}?width=${width}&height=${height}&model=flux&nologo=true&safe=true&seed=${seed}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "montage-video/1.0",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Pollinations : ${res.status}`);
    if (!res.headers.get("content-type")?.startsWith("image/"))
      throw new Error("Pollinations : pas une image");
    return {
      source: "pollinations",
      id: `${seed}-${hash(prompt)}`,
      kind: "image",
      url: "",
      data: Buffer.from(await res.arrayBuffer()),
      width,
      height,
      durationSec: null,
      credit: "Image IA (Flux, Pollinations)",
    };
  }
}

/** Petit hachage stable pour nommer l'image (même invite + même graine = même fichier). */
export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Générateurs actifs, dans l'ordre de AI_IMAGE_PROVIDERS. */
export function imageGenerators(): ImageGenerator[] {
  const e = env();
  const list: ImageGenerator[] = [];
  for (const name of e.AI_IMAGE_PROVIDERS.split(",").map((s) => s.trim())) {
    if (name === "cloudflare" && e.CLOUDFLARE_ACCOUNT_ID && e.CLOUDFLARE_API_TOKEN)
      list.push(new CloudflareGenerator(e.CLOUDFLARE_ACCOUNT_ID, e.CLOUDFLARE_API_TOKEN));
    if (name === "fal" && e.FAL_KEY) list.push(new FalGenerator(e.FAL_KEY));
    if (name === "pollinations") list.push(new PollinationsGenerator(e.POLLINATIONS_TOKEN));
  }
  return list;
}

/**
 * Essaie chaque générateur dans l'ordre. Un générateur qui échoue est mis de côté pour le reste
 * de la vidéo (quota atteint, service lent) : on ne le fait pas attendre à chaque scène.
 */
export async function generateImage(
  generators: ImageGenerator[],
  broken: Set<string>,
  prompt: string,
  orientation: Orientation,
  seed: number,
): Promise<StockItem | null> {
  for (const g of generators) {
    if (broken.has(g.name)) continue;
    try {
      return await g.generate(prompt, orientation, seed);
    } catch (err) {
      broken.add(g.name);
      console.error("[images IA]", g.name, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
