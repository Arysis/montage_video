import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { resetEnvCache } from "@/lib/env";

/** Base dédiée aux tests, stockage et dossier de travail temporaires, services simulés. */
export async function setupIntegration() {
  const root = mkdtempSync(path.join(tmpdir(), "montage-it-"));
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/montage_test",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: path.join(root, "storage"),
    WORK_DIR: path.join(root, "work"),
    AI_PROVIDER: "mock",
    STT_PROVIDER: "mock",
    PUBLISH_PROVIDER: "mock",
    EMAIL_PROVIDER: "log",
  });
  resetEnvCache();
  await runMigrations();
  await db().execute(sql`truncate users, rate_limits cascade`);
  return root;
}

/** Une « voix » de synthèse (bruit rose modulé comme des syllabes), en WebM Opus comme le prompteur. */
export function makeVoice(dir: string, seconds = 12): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "voix.webm");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=pink:amplitude=0.4:d=${seconds}`,
    "-af",
    "bandpass=f=700:width_type=o:w=2,volume='0.2+0.8*abs(sin(2*PI*3*t))':eval=frame",
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    file,
  ]);
  return file;
}

export function makeImage(dir: string, color = "0x3355aa"): string {
  const file = path.join(dir, `image-${color}.png`);
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=720x1280`,
    "-frames:v",
    "1",
    file,
  ]);
  return file;
}
