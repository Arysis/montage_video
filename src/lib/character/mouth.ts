import { POSE_LETTER } from "./poses";

/** Cadence de la piste de bouche : une lettre par image vidéo. */
export const MOUTH_FPS = 30;

/**
 * Enveloppe de la voix : volume (dB) de chaque tranche de 1/30 s.
 * Lit un WAV PCM 16 bits (celui que le montage prépare : mono 48 kHz).
 */
export function voiceEnvelope(wav: Buffer, fps = MOUTH_FPS): Float32Array {
  // Trouver les morceaux « fmt » et « data » du fichier RIFF.
  let pos = 12;
  let channels = 1;
  let rate = 48000;
  let bits = 16;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("latin1", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(pos + 10);
      rate = wav.readUInt32LE(pos + 12);
      bits = wav.readUInt16LE(pos + 22);
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(size, wav.length - dataStart);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (dataStart < 0 || bits !== 16) throw new Error("WAV PCM 16 bits attendu pour l'enveloppe de la voix.");
  const frameBytes = 2 * channels;
  const samples = Math.floor(dataLen / frameBytes);
  const perSlice = Math.max(1, Math.round(rate / fps));
  const slices = Math.ceil(samples / perSlice);
  const env = new Float32Array(slices);
  for (let s = 0; s < slices; s++) {
    let sum = 0;
    const from = s * perSlice;
    const to = Math.min(samples, from + perSlice);
    for (let i = from; i < to; i++) {
      const v = wav.readInt16LE(dataStart + i * frameBytes) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    env[s] = rms > 0 ? 20 * Math.log10(rms) : -100;
  }
  return env;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return -100;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
}

export type MouthOptions = {
  hasHalf: boolean;
  hasOpen: boolean;
  hasBlink: boolean;
};

/**
 * Piste de bouche du personnage, une lettre par image (c fermée, h mi-ouverte, o ouverte, b yeux fermés).
 * La bouche ne bouge que pendant les mots dits, et s'ouvre selon le volume de la voix à cet instant.
 * Calcul local, sans IA.
 */
export function mouthTrack(
  envelope: Float32Array,
  words: { start: number; end: number }[],
  opts: MouthOptions & { trimStart: number; durationSec: number; fps?: number },
): string {
  const fps = opts.fps ?? MOUTH_FPS;
  const frames = Math.max(0, Math.round(opts.durationSec * fps));
  const at = (f: number) => envelope[Math.floor(f + opts.trimStart * fps)] ?? -100;
  const C = POSE_LETTER.closed;
  const canTalk = opts.hasOpen || opts.hasHalf;

  // Images où un mot est en cours (léger débord : la bouche s'ouvre juste avant le son).
  const speaking = new Uint8Array(frames);
  for (const w of canTalk ? words : []) {
    const a = Math.max(0, Math.floor((w.start - opts.trimStart - 0.03) * fps));
    const b = Math.min(frames, Math.ceil((w.end - opts.trimStart) * fps));
    for (let f = a; f < b; f++) speaking[f] = 1;
  }
  const quiet: number[] = [];
  const spoken: number[] = [];
  for (let f = 0; f < frames; f++) (speaking[f] ? spoken : quiet).push(at(f));
  // Volume fort de la voix et volume de repos (bruit de fond entre les mots), propres à cette prise.
  // Le repos est gardé au moins 18 dB sous la voix : une prise sans pause fait quand même parler.
  // On étale ensuite la dynamique de la parole elle-même : les syllabes faibles ferment la bouche.
  const peak = percentile(spoken, 0.9);
  const rest = Math.min(quiet.length >= 5 ? percentile(quiet, 0.5) : -70, peak - 18);
  const floor = Math.min(Math.max(rest, percentile(spoken, 0.12)), peak - 6);

  const open = opts.hasOpen ? POSE_LETTER.open : POSE_LETTER.half;
  const half = opts.hasHalf ? POSE_LETTER.half : null;
  const raw: string[] = [];
  for (let f = 0; f < frames; f++) {
    if (!speaking[f]) {
      raw.push(C);
      continue;
    }
    const level = (at(f) - floor) / (peak - floor);
    if (level < 0.3) raw.push(C);
    else if (half && level < 0.65) raw.push(half);
    else if (!half && level < 0.45) raw.push(C);
    else raw.push(open);
  }

  // Lissage : une pose tient au moins 2 images (66 ms), sinon la bouche « clignote ».
  for (let f = 1; f < frames - 1; f++) {
    if (raw[f] !== raw[f - 1] && raw[f] !== raw[f + 1]) raw[f] = raw[f - 1]!;
  }
  // Une bouche ne reste pas grande ouverte longtemps : on la referme à moitié toutes les 8 images.
  let run = 0;
  for (let f = 0; f < frames; f++) {
    run = raw[f] === open ? run + 1 : 0;
    if (run > 8) {
      raw[f] = half ?? C;
      run = 0;
    }
  }

  // Clignements d'yeux pendant les silences, toutes les 3 à 5 s (suite fixe : le rendu est reproductible).
  if (opts.hasBlink) {
    let next = Math.round(1.6 * fps);
    let k = 0;
    while (next < frames) {
      const len = 4;
      if (raw.slice(next, next + len).every((x) => x === C)) {
        for (let f = next; f < Math.min(frames, next + len); f++) raw[f] = POSE_LETTER.blink;
        k++;
        next += Math.round((3 + ((k * 7) % 5) * 0.5) * fps);
      } else {
        next += 3;
      }
    }
  }
  return raw.join("");
}

/** Découpe la piste en suites d'une même pose : [lettre, nombre d'images]. */
export function runs(track: string): [string, number][] {
  const out: [string, number][] = [];
  for (const ch of track) {
    const last = out[out.length - 1];
    if (last && last[0] === ch) last[1]++;
    else out.push([ch, 1]);
  }
  return out;
}
