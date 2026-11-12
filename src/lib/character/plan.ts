import { mouthTrack, MOUTH_FPS } from "./mouth";
import type { CharacterGroup } from "./poses";
import { characterBox, type CharacterRig } from "./render";

export type TalkingCharacter = {
  group: CharacterGroup;
  /** Largeur / hauteur de l'image principale. */
  aspect: number;
};

type SceneLike = { start: number; end: number; character?: { assetId: string; talking: boolean } | null };

/**
 * Prépare l'animation de chaque personnage présent dans le plan : sa place à l'écran et sa piste
 * de bouche. La bouche ne bouge que dans les scènes où il parle ; ailleurs elle reste fermée.
 */
export function buildCharacterRigs(input: {
  format: "9:16" | "1:1" | "16:9";
  width: number;
  height: number;
  durationSec: number;
  scenes: SceneLike[];
  characters: TalkingCharacter[];
  /** Enveloppe de la voix (dB par 1/30 s, depuis le début de la prise). */
  envelope: Float32Array | null;
  words: { start: number; end: number }[];
  trimStart: number;
}): Record<string, CharacterRig> {
  const rigs: Record<string, CharacterRig> = {};
  const frames = Math.round(input.durationSec * MOUTH_FPS);
  for (const c of input.characters) {
    const id = c.group.mainId;
    const scenes = input.scenes.filter((s) => s.character?.assetId === id);
    if (!scenes.length) continue;
    const talking = c.group.canTalk && input.envelope ? scenes.filter((s) => s.character!.talking) : [];
    let mouth = "c".repeat(frames);
    if (talking.length && input.envelope) {
      const full = mouthTrack(input.envelope, input.words, {
        hasOpen: !!c.group.poses.open,
        hasHalf: !!c.group.poses.half,
        hasBlink: !!c.group.poses.blink,
        trimStart: input.trimStart,
        durationSec: input.durationSec,
      });
      // On ne garde la bouche animée que dans les scènes où ce personnage parle.
      const keep = new Uint8Array(frames);
      for (const s of talking) {
        for (let f = Math.floor(s.start * MOUTH_FPS); f < Math.min(frames, Math.ceil(s.end * MOUTH_FPS)); f++)
          keep[f] = 1;
      }
      mouth = [...full].map((ch, f) => (keep[f] || ch === "b" ? ch : "c")).join("");
    } else if (c.group.poses.blink && input.envelope) {
      // Personnage muet : il cligne quand même des yeux.
      mouth = mouthTrack(input.envelope, [], {
        hasOpen: false,
        hasHalf: false,
        hasBlink: true,
        trimStart: input.trimStart,
        durationSec: input.durationSec,
      });
    }
    rigs[id] = {
      poses: c.group.poses,
      box: characterBox(input.format, input.width, input.height, c.aspect),
      mouth,
    };
  }
  return rigs;
}
