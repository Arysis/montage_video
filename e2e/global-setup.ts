import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const FIXTURES = path.resolve(".data/e2e-fixtures");

/** Fichiers de test : une image et une « voix » (bruit rose modulé comme des syllabes) pour le micro simulé. */
export default function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  const ff = (args: string[]) =>
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3355aa:s=720x1280",
    "-frames:v",
    "1",
    path.join(FIXTURES, "photo-produit.png"),
  ]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:amplitude=0.5:d=30",
    "-af",
    "bandpass=f=700:width_type=o:w=2,volume='0.25+0.75*abs(sin(2*PI*3*t))':eval=frame",
    "-ar",
    "48000",
    "-ac",
    "1",
    path.join(FIXTURES, "voix.wav"),
  ]);
}
