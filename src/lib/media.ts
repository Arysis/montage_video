import { env } from "@/lib/env";
import { probe } from "@/lib/qc/post-render";
import { run } from "@/lib/render/ffmpeg";

/** Durée réelle d'un fichier audio ou vidéo (les enregistrements WebM du navigateur n'ont pas toujours de durée). */
export async function mediaDuration(file: string): Promise<number> {
  const e = env();
  const p = await probe(e.FFPROBE_PATH, file).catch(() => null);
  if (p && Number.isFinite(p.durationSec) && p.durationSec > 0) return p.durationSec;
  const { stderr } = await run(e.FFMPEG_PATH, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-f",
    "null",
    "-",
  ]).catch((err) => ({
    stderr: String(err),
  }));
  const times = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  if (!last) return 0;
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}
