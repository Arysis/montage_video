import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { analyzeAudio } from "@/lib/qc/post-render";
import { run } from "@/lib/render/ffmpeg";

/** Volume visé pour la voix seule, avant le mixage avec la musique (la vidéo finale vise -14 LUFS). */
export const VOICE_TARGET_LUFS = -16;

/**
 * Chaîne de nettoyage de la voix, dans l'ordre :
 * - coupe les graves inutiles (souffle, ronflement électrique, chocs sur le micro) ;
 * - débruitage : réseau RNNoise (arnndn) quand son modèle est installé, puis débruitage FFT léger ;
 * - égalisation : moins de « boue » vers 250 Hz, plus de présence vers 4 kHz ;
 * - atténue les « s » sifflants, compresse pour une voix régulière, limiteur contre la saturation.
 * Aucun de ces filtres ne décale le son : les horodatages des mots restent valables.
 */
export function voiceCleanFilter(opts: { rnnModelPath?: string | null } = {}): string {
  // Chemin sans caractère spécial, pour ne pas avoir à l'échapper dans le graphe de filtres.
  const model = opts.rnnModelPath && /^[\w./-]+$/.test(opts.rnnModelPath) ? opts.rnnModelPath : null;
  const denoise = model
    ? [`arnndn=m=${model}:mix=0.85`, "afftdn=nr=10:nf=-45:tn=1"]
    : ["afftdn=nr=20:nf=-40:tn=1"];
  return [
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=mono",
    "highpass=f=90:poles=2",
    "lowpass=f=15000",
    ...denoise,
    "equalizer=f=250:t=q:w=1.2:g=-2",
    "equalizer=f=4000:t=q:w=1.5:g=2",
    "deesser=i=0.25",
    "acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=1",
    "alimiter=limit=0.89:level=disabled",
  ].join(",");
}

/** Gain (dB) pour amener la voix nettoyée à VOICE_TARGET_LUFS, borné à ±18 dB. */
export function voiceGain(lufs: number): number {
  if (!Number.isFinite(lufs) || lufs < -60) return 0;
  return Math.max(-18, Math.min(18, VOICE_TARGET_LUFS - lufs));
}

/**
 * Nettoie la prise de voix et l'écrit en WAV mono 48 kHz (format fixe pour le rendu).
 * Deux passes : nettoyage, puis gain fixe vers -16 LUFS. Un gain fixe plutôt qu'une normalisation
 * dynamique, pour ne pas faire remonter le bruit de fond dans les pauses.
 */
export async function cleanVoice(
  ffmpeg: string,
  input: string,
  output: string,
  opts: { rnnModelPath?: string | null } = {},
): Promise<{ gainDb: number; denoiser: "rnnoise" | "fft" }> {
  const model = opts.rnnModelPath && existsSync(opts.rnnModelPath) ? opts.rnnModelPath : null;
  const cleaned = `${output}.clean.wav`;
  try {
    await run(ffmpeg, [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vn",
      "-af",
      voiceCleanFilter({ rnnModelPath: model }),
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "pcm_f32le",
      cleaned,
    ]);
    const gainDb = voiceGain((await analyzeAudio(ffmpeg, cleaned)).integratedLufs);
    await run(ffmpeg, [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-y",
      "-i",
      cleaned,
      "-af",
      `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.89:level=disabled`,
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      output,
    ]);
    return { gainDb, denoiser: model ? "rnnoise" : "fft" };
  } finally {
    await rm(cleaned, { force: true });
  }
}
