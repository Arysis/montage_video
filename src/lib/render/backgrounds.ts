import path from "node:path";
import sharp from "sharp";
import type { PlanScene } from "@/lib/plan/schema";

type Generated = Extract<PlanScene["visual"], { type: "generated" }>;

/** Marge autour de l'image pour la faire dériver lentement (le fond bouge). */
export const BG_MARGIN = 1.2;

/** Générateur pseudo-aléatoire déterministe : le même fond à chaque rendu. */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

export const backgroundKey = (v: Generated) => `${v.style}-${v.seed}-${v.colors.join("").replace(/#/g, "")}`;

/** Le dessin du fond (SVG) : taches de couleur floues, lueur, vignette. */
export function backgroundSvg(v: Generated, W: number, H: number): string {
  const [primary, background, accent = primary] = v.colors as [string, string, string?];
  const r = rng(v.seed);
  const w = Math.round(W * BG_MARGIN);
  const h = Math.round(H * BG_MARGIN);
  const blob = (color: string, opacity: number, size: number) =>
    `<circle cx="${Math.round(r() * w)}" cy="${Math.round(r() * h)}" r="${Math.round(size * Math.max(w, h))}" fill="${color}" opacity="${opacity}"/>`;
  let base = `<rect width="${w}" height="${h}" fill="${background}"/>`;
  let blobs = "";
  switch (v.style) {
    case "nuit":
      blobs = [blob(primary, 0.35, 0.35), blob(accent, 0.18, 0.3)].join("");
      break;
    case "degrade":
      base = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
      blobs = [blob(background, 0.35, 0.3), blob(primary, 0.6, 0.25), blob(accent, 0.5, 0.25)].join("");
      break;
    case "particules":
      blobs = [blob(primary, 0.3, 0.3), blob(accent, 0.15, 0.25)].join("");
      break;
    default:
      blobs = [
        blob(primary, 0.75, 0.32),
        blob(accent, 0.6, 0.28),
        blob(primary, 0.45, 0.22),
        blob(background, 0.7, 0.25),
      ].join("");
  }
  const blur = Math.round(Math.max(w, h) * 0.09);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><filter id="b" x="-100%" y="-100%" width="300%" height="300%" filterUnits="objectBoundingBox"><feGaussianBlur stdDeviation="${blur}"/></filter>
<radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
${base}<g filter="url(#b)">${blobs}</g><rect width="${w}" height="${h}" fill="url(#v)"/></svg>`;
}

/** Calque de points lumineux (deux écrans de haut, pour défiler en boucle). */
export function particlesSvg(v: Generated, W: number, H: number): string {
  const [primary] = v.colors as [string];
  const r = rng(v.seed + 99);
  const dots: string[] = [];
  for (let i = 0; i < 70; i++) {
    const x = Math.round(r() * W);
    const y = Math.round(r() * H);
    const size = Math.round(3 + r() * 9);
    const op = (0.25 + r() * 0.6).toFixed(2);
    // Chaque point est dessiné deux fois (y et y + H) pour que la boucle soit invisible.
    for (const dy of [0, H])
      dots.push(`<circle cx="${x}" cy="${y + dy}" r="${size}" fill="url(#p)" opacity="${op}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H * 2}">
<defs><radialGradient id="p"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.4" stop-color="${primary}"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></radialGradient></defs>
${dots.join("")}</svg>`;
}

export type BackgroundFiles = { image: string; particles: string | null };

/** Écrit les images du fond (PNG) dans le dossier de travail. */
export async function renderBackground(
  v: Generated,
  W: number,
  H: number,
  dir: string,
): Promise<BackgroundFiles> {
  const key = backgroundKey(v);
  const image = path.join(dir, `bg-${key}-${W}.png`);
  await sharp(Buffer.from(backgroundSvg(v, W, H)))
    .png()
    .toFile(image);
  let particles: string | null = null;
  if (v.style === "particules") {
    particles = path.join(dir, `bg-${key}-${W}-dots.png`);
    await sharp(Buffer.from(particlesSvg(v, W, H)))
      .png()
      .toFile(particles);
  }
  return { image, particles };
}
