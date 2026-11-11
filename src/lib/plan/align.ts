import type { WordTiming } from "@/lib/stt/types";

export function normalizeToken(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean);
}

/**
 * Aligne les mots du script sur les mots transcrits (plus longue sous-séquence commune).
 * Renvoie, pour chaque mot du script, l'index du mot transcrit correspondant ou -1.
 */
export function alignWords(scriptTokens: string[], spoken: string[]): number[] {
  const n = scriptTokens.length;
  const m = spoken.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        scriptTokens[i] === spoken[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const map = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (scriptTokens[i] === spoken[j]) {
      map[i] = j;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return map;
}

export type SceneSpan = { sceneId: string; firstWord: number; lastWord: number; coverage: number };

/**
 * Trouve, pour chaque scène du script, la plage de mots transcrits qui lui correspond.
 * Quand une scène n'a aucun mot reconnu, sa plage est déduite des voisines (répartition proportionnelle).
 */
export function sceneSpans(scenes: { id: string; text: string }[], words: WordTiming[]): SceneSpan[] {
  const spoken = words.map((w) => normalizeToken(w.word));
  const sceneTokens = scenes.map((s) => tokenize(s.text));
  const flat = sceneTokens.flat();
  const map = alignWords(flat, spoken);

  const spans: SceneSpan[] = [];
  let offset = 0;
  for (let k = 0; k < scenes.length; k++) {
    const len = sceneTokens[k]!.length;
    const matched = map.slice(offset, offset + len).filter((x) => x >= 0);
    spans.push({
      sceneId: scenes[k]!.id,
      firstWord: matched.length ? Math.min(...matched) : -1,
      lastWord: matched.length ? Math.max(...matched) : -1,
      coverage: len ? matched.length / len : 0,
    });
    offset += len;
  }

  // Rendre les plages contiguës : chaque mot transcrit appartient à une seule scène.
  const total = words.length;
  let cursor = 0;
  for (let k = 0; k < spans.length; k++) {
    const span = spans[k]!;
    const remainingScenes = spans.length - k;
    if (span.firstWord < 0) {
      const share = Math.max(1, Math.floor((total - cursor) / remainingScenes));
      span.firstWord = Math.min(cursor, Math.max(0, total - 1));
      span.lastWord = Math.min(total - 1, cursor + share - 1);
    } else {
      span.firstWord = Math.min(Math.max(span.firstWord, cursor), Math.max(0, total - 1));
      span.lastWord = Math.max(span.lastWord, span.firstWord);
    }
    if (k === spans.length - 1) span.lastWord = Math.max(span.lastWord, total - 1);
    cursor = span.lastWord + 1;
  }
  // Combler les mots non attribués entre deux scènes : ils vont à la scène précédente.
  for (let k = 0; k < spans.length - 1; k++) {
    spans[k]!.lastWord = Math.max(spans[k]!.lastWord, spans[k + 1]!.firstWord - 1);
  }
  return spans;
}
