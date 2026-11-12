/**
 * Personnages à plusieurs images : chaque image importée est une « pose » d'un même personnage
 * (bouche fermée, mi-ouverte, ouverte, yeux fermés). On les regroupe par nom de personnage
 * pour animer la bouche sur la voix, sans IA (aucun jeton dépensé).
 */

export const POSES = ["closed", "half", "open", "blink"] as const;
export type Pose = (typeof POSES)[number];

export const POSE_LABELS: Record<Pose, string> = {
  closed: "Bouche fermée",
  half: "Bouche mi-ouverte",
  open: "Bouche ouverte",
  blink: "Yeux fermés",
};

/** Lettre de chaque pose dans la piste de bouche du plan (une lettre par image vidéo). */
export const POSE_LETTER: Record<Pose, string> = { closed: "c", half: "h", open: "o", blink: "b" };

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Devine la pose d'après le nom du fichier (« renard-bouche-ouverte.png » → open). */
export function detectPose(fileName: string): Pose {
  const n = strip(fileName.replace(/\.[a-z0-9]+$/i, ""));
  if (/(yeux|eyes?|blink|cligne|clin)/.test(n)) return "blink";
  if (/(mi[-_ ]?ouvert|demi|half|mid|moitie)/.test(n)) return "half";
  if (/(ouvert|open|parle|talk|\bo\b|_o$|-o$)/.test(n)) return "open";
  return "closed";
}

const POSE_WORDS =
  /\b(bouche|mouth|yeux|eyes?|blink|cligne|clin|mi|demi|half|mid|moitie|ouverte?s?|open|opened|fermee?s?|closed?|parle|talk|repos|neutre|neutral|idle|o|f|c|\d+)\b/g;

/** Nom du personnage tiré du nom de fichier, sans les mots de pose (« renard-bouche-ouverte » → « renard »). */
export function characterNameFrom(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = strip(base)
    .replace(/[-_.]+/g, " ")
    .replace(POSE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || strip(base).trim() || "personnage").slice(0, 60);
}

export type CharacterImage = {
  id: string;
  kind: string;
  characterName: string | null;
  pose: string | null;
  width?: number | null;
  height?: number | null;
  createdAt?: Date;
};

export type PoseSet = { closed: string; half: string | null; open: string | null; blink: string | null };

export type CharacterGroup = {
  /** Image principale (bouche fermée) : c'est elle que l'IA et le script désignent. */
  mainId: string;
  name: string;
  poses: PoseSet;
  /** Vrai si la bouche peut bouger (au moins une image bouche ouverte ou mi-ouverte). */
  canTalk: boolean;
  /** Toutes les images du personnage. */
  ids: string[];
};

const groupKey = (a: CharacterImage) =>
  a.characterName ? `n:${a.characterName.toLowerCase()}` : `i:${a.id}`;

/** Regroupe les images de personnages par nom. Une image sans nom forme un personnage à elle seule. */
export function groupCharacters(assets: CharacterImage[]): CharacterGroup[] {
  const groups = new Map<string, CharacterImage[]>();
  for (const a of assets) {
    if (a.kind !== "character") continue;
    const k = groupKey(a);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: CharacterGroup[] = [];
  for (const images of groups.values()) {
    // La plus ancienne image d'une pose l'emporte : un réimport ne casse pas un personnage.
    const sorted = [...images].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    const poses: Record<Pose, string | null> = { closed: null, half: null, open: null, blink: null };
    for (const img of sorted) {
      const p = (POSES as readonly string[]).includes(img.pose ?? "") ? (img.pose as Pose) : "closed";
      poses[p] ??= img.id;
    }
    // Sans image « bouche fermée », la première image importée sert de repos.
    const closed =
      poses.closed ?? sorted.find((i) => i.id !== poses.open && i.id !== poses.half)?.id ?? sorted[0]!.id;
    out.push({
      mainId: closed,
      name: sorted[0]!.characterName ?? "Personnage",
      poses: { ...poses, closed },
      canTalk: !!(poses.open || poses.half),
      ids: sorted.map((i) => i.id),
    });
  }
  return out;
}

/** Le groupe d'un asset (par n'importe laquelle de ses images). */
export function groupOf(groups: CharacterGroup[], assetId: string): CharacterGroup | undefined {
  return groups.find((g) => g.ids.includes(assetId));
}
