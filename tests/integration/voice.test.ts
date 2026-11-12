import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanVoice, VOICE_TARGET_LUFS } from "@/lib/audio/voice";
import { analyzeAudio, probe } from "@/lib/qc/post-render";

const hasEspeak = spawnSync("espeak-ng", ["--version"]).status === 0;

/** Une phrase dite par espeak-ng (après une seconde de silence), sur un bruit de fond et un ronflement à 50 Hz. */
function noisyTake(dir: string): string {
  const file = path.join(dir, "prise.wav");
  const speechFile = path.join(dir, "phrase.wav");
  execFileSync("espeak-ng", [
    "-v",
    "fr",
    "-w",
    speechFile,
    "Bonjour à tous. Aujourd'hui, je vous montre comment monter une vidéo en deux minutes.",
  ]);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    speechFile,
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=c=pink:a=0.04:d=8:seed=7",
    "-f",
    "lavfi",
    "-i",
    "sine=f=50:d=8,volume=0.03",
    "-filter_complex",
    "[0]aresample=48000,adelay=1000,apad,atrim=0:6,volume=0.5[v];[v][1][2]amix=inputs=3:normalize=0:duration=first,aformat=channel_layouts=mono",
    "-ar",
    "44100",
    file,
  ]);
  return file;
}

function meanVolume(file: string, from: number, to: number): number {
  const { stderr } = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", `atrim=${from}:${to},volumedetect`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? NaN);
}

// espeak-ng est installé par la CI ; sans lui, pas de voix réaliste pour ce test.
describe.skipIf(!hasEspeak)("nettoyage de la voix (FFmpeg réel)", () => {
  it("baisse le bruit dans les pauses, règle le volume et garde le son à sa place", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "voix-"));
    const input = noisyTake(dir);
    const output = path.join(dir, "propre.wav");
    const res = await cleanVoice("ffmpeg", input, output, {
      rnnModelPath: process.env.TEST_RNNOISE_MODEL,
    });

    const info = await probe("ffprobe", output);
    expect(Math.abs(info.durationSec - 6)).toBeLessThan(0.05);

    // Écart entre parole et pause (rapport signal/bruit) : nettement meilleur après nettoyage.
    const snrBefore = meanVolume(input, 3.2, 4.3) - meanVolume(input, 0.1, 0.9);
    const snrAfter = meanVolume(output, 3.2, 4.3) - meanVolume(output, 0.1, 0.9);
    console.warn(`rapport signal/bruit : ${snrBefore.toFixed(1)} dB -> ${snrAfter.toFixed(1)} dB`);
    expect(snrAfter).toBeGreaterThan(snrBefore + (res.denoiser === "rnnoise" ? 10 : 4));

    // Le son ne se décale pas : la pause avant la première phrase reste une pause.
    expect(meanVolume(output, 1.1, 1.9) - meanVolume(output, 0.3, 0.9)).toBeGreaterThan(15);

    const audio = await analyzeAudio("ffmpeg", output);
    expect(Math.abs(audio.integratedLufs - VOICE_TARGET_LUFS)).toBeLessThan(1.5);
    expect(audio.truePeakDb).toBeLessThan(0);
    expect(res.denoiser).toBe(process.env.TEST_RNNOISE_MODEL ? "rnnoise" : "fft");
  });
});
