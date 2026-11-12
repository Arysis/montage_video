import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MOUTH_FPS, runs } from "./mouth";
import { POSE_LETTER, type Pose, POSES, type PoseSet } from "./poses";

export type Box = { x: number; y: number; w: number; h: number };

export type CharacterRig = {
  poses: PoseSet;
  /** Place du personnage dans l'image, en pixels du plan. */
  box: Box;
  /** Piste de bouche, une lettre par image à 30 i/s (voir mouthTrack). */
  mouth: string;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Où placer le personnage : en bas au centre en vertical (les sous-titres passent au-dessus),
 * en bas à droite en carré et en horizontal. aspect = largeur / hauteur de l'image.
 */
export function characterBox(format: "9:16" | "1:1" | "16:9", W: number, H: number, aspect: number): Box {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75;
  const [hRatio, wMax] = format === "9:16" ? [0.4, 0.8] : format === "1:1" ? [0.5, 0.45] : [0.62, 0.35];
  let h = H * hRatio;
  let w = h * a;
  if (w > W * wMax) {
    w = W * wMax;
    h = w / a;
  }
  const bw = even(w);
  const bh = even(h);
  const x = format === "9:16" ? Math.round((W - bw) / 2) : Math.round(W - bw - W * 0.04);
  return { x, y: H - bh, w: bw, h: bh };
}

/** Pose de remplacement quand une image manque (ex. pas d'image mi-ouverte : on prend l'ouverte). */
function fallback(poses: PoseSet, pose: Pose): Pose {
  if (poses[pose]) return pose;
  if (pose === "half") return poses.open ? "open" : "closed";
  if (pose === "open") return poses.half ? "half" : "closed";
  return "closed";
}

/**
 * Prépare les images du personnage à la taille exacte de sa place (fond transparent),
 * puis écrit la liste « concat » qui enchaîne les poses image par image.
 * Renvoie le chemin de cette liste, à donner à FFmpeg comme une entrée vidéo.
 */
export async function prepareCharacter(
  rig: CharacterRig,
  files: Map<string, string>,
  dir: string,
  scale = 1,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const w = even(rig.box.w * scale);
  const h = even(rig.box.h * scale);
  const byLetter = new Map<string, string>();
  for (const pose of POSES) {
    const use = fallback(rig.poses, pose);
    const id = rig.poses[use];
    const src = id ? files.get(id) : undefined;
    if (!src) throw new Error(`Image du personnage introuvable (${use}).`);
    const out = path.join(dir, `${POSE_LETTER[pose]}.png`);
    await sharp(src, { density: 300 })
      .resize(w, h, { fit: "contain", position: "bottom", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png()
      .toFile(out);
    byLetter.set(POSE_LETTER[pose], out);
  }
  const list = path.join(dir, "mouth.ffconcat");
  await writeFile(list, concatList(rig.mouth, byLetter));
  return list;
}

const quote = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;

/** Liste pour le démultiplexeur concat de FFmpeg : chaque pose avec sa durée. */
export function concatList(mouth: string, byLetter: Map<string, string>, fps = MOUTH_FPS): string {
  const lines = ["ffconcat version 1.0"];
  const parts = runs(mouth.length ? mouth : POSE_LETTER.closed);
  for (const [letter, n] of parts) {
    const file = byLetter.get(letter) ?? byLetter.get(POSE_LETTER.closed)!;
    lines.push(`file ${quote(file)}`, `duration ${(n / fps).toFixed(6)}`);
  }
  // Le démultiplexeur ignore la durée de la dernière entrée : on la répète.
  const last = parts[parts.length - 1]!;
  lines.push(`file ${quote(byLetter.get(last[0]) ?? byLetter.get(POSE_LETTER.closed)!)}`);
  return lines.join("\n") + "\n";
}

/**
 * Morceau de graphe FFmpeg qui incruste le personnage animé sur `videoIn`.
 * `inputIndex` est l'index de l'entrée concat ajoutée par `characterInputArgs`.
 * Le personnage respire légèrement (petit mouvement vertical) pour ne pas paraître figé.
 */
export function characterOverlay(opts: {
  rig: CharacterRig;
  inputIndex: number;
  videoIn: string;
  out: string;
  label: string;
  fps: number;
  scale?: number;
  /** Intervalles (secondes) où le personnage est à l'écran. */
  visible: { start: number; end: number }[];
}): string[] {
  const s = opts.scale ?? 1;
  const x = Math.round(opts.rig.box.x * s);
  const y = Math.round(opts.rig.box.y * s);
  const amp = Math.max(2, Math.round(opts.rig.box.h * s * 0.012));
  const enable = opts.visible.length
    ? opts.visible.map((v) => `between(t,${v.start.toFixed(3)},${v.end.toFixed(3)})`).join("+")
    : "0";
  return [
    `[${opts.inputIndex}:v]fps=${opts.fps},format=rgba,setpts=PTS-STARTPTS[${opts.label}]`,
    `[${opts.videoIn}][${opts.label}]overlay=x=${x}:y='${y}+${amp}+${amp}*sin(2*PI*t/2.6)':eval=frame:eof_action=pass:enable='${enable}'[${opts.out}]`,
  ];
}

/** Arguments d'entrée FFmpeg pour la liste concat d'un personnage. */
export function characterInputArgs(listPath: string): string[] {
  return ["-f", "concat", "-safe", "0", "-i", listPath];
}

/** Rassemble les intervalles qui se touchent (moins de 2 images d'écart). */
export function mergeIntervals(list: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start - last.end < 0.07) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}
