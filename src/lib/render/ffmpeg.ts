import { spawn } from "node:child_process";
import type { EditPlan } from "@/lib/plan/schema";

export type ResolvedMedia = {
  /** Chemin local de chaque asset du plan (vidéo, image, musique, logo en PNG). */
  assets: Map<string, { path: string; kind: string }>;
  voicePath: string | null;
  assPath: string;
  fontsDir: string;
};

export type RenderOptions = { preset?: string; crf?: number; scale?: number };

const hex0x = (hex: string) => `0x${hex.slice(1)}`;
const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/**
 * Traduit un plan de montage en une commande FFmpeg unique (filter_complex).
 * Pur et testable : ne lance rien.
 */
export function buildFfmpegArgs(
  plan: EditPlan,
  media: ResolvedMedia,
  outPath: string,
  opts: RenderOptions = {},
) {
  const scale = opts.scale ?? 1;
  const W = Math.round((plan.width * scale) / 2) * 2;
  const H = Math.round((plan.height * scale) / 2) * 2;
  const fps = plan.fps;
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
  const filters: string[] = [];
  let inputIndex = 0;
  const sceneLabels: string[] = [];

  plan.scenes.forEach((scene, k) => {
    const dur = scene.end - scene.start;
    const frames = Math.max(1, Math.round(dur * fps));
    const label = `v${k}`;
    if (scene.visual.type === "color") {
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=${hex0x(scene.visual.color)}:s=${W}x${H}:r=${fps}:d=${dur.toFixed(3)}`,
      );
      filters.push(
        `[${inputIndex}:v]format=yuv420p,setsar=1,trim=end_frame=${frames},setpts=PTS-STARTPTS[${label}]`,
      );
    } else {
      const asset = media.assets.get(scene.visual.assetId);
      if (!asset) throw new Error(`Asset absent pour la scène ${scene.id}`);
      const isVideo = asset.kind === "video";
      if (isVideo) {
        args.push("-ss", scene.visual.sourceStart.toFixed(3), "-t", (dur + 0.5).toFixed(3), "-i", asset.path);
      } else {
        args.push("-i", asset.path);
      }
      const motion = scene.visual.motion;
      const zoomExpr =
        motion === "zoom-in" ? `1+0.12*on/${frames}` : motion === "zoom-out" ? `1.12-0.12*on/${frames}` : "1";
      // Les images et les zooms sont calculés en double résolution pour éviter les saccades.
      const k = !isVideo || motion !== "none" ? 2 : 1;
      const base = `[${inputIndex}:v]scale=${W * k}:${H * k}:force_original_aspect_ratio=increase,crop=${W * k}:${H * k},setsar=1`;
      const zoom = isVideo
        ? motion === "none"
          ? `fps=${fps}`
          : `fps=${fps},zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}`
        : `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`;
      // tpad clone : si le rush est plus court que le plan, on fige la dernière image au lieu d'un trou.
      filters.push(
        `${base},${zoom},format=yuv420p,tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},trim=end_frame=${frames},setpts=PTS-STARTPTS[${label}]`,
      );
    }
    sceneLabels.push(`[${label}]`);
    inputIndex++;
  });

  filters.push(`${sceneLabels.join("")}concat=n=${sceneLabels.length}:v=1:a=0[vcat]`);
  let videoOut = "vcat";

  if (plan.logo) {
    const logo = media.assets.get(plan.logo.assetId);
    if (logo) {
      args.push("-i", logo.path);
      const lw = Math.round(W * plan.logo.widthRatio);
      const margin = Math.round(W * 0.06);
      const x = plan.logo.position === "top-right" ? `W-w-${Math.round(W * 0.13)}` : `${margin}`;
      const y = `${Math.round(H * (plan.format === "9:16" ? 0.07 : 0.04))}`;
      filters.push(`[${inputIndex}:v]scale=${lw}:-1,format=rgba[logo]`);
      filters.push(
        `[${videoOut}][logo]overlay=x=${x}:y=${y}:enable='between(t,${plan.logo.showFrom},${plan.logo.showUntil})'[vlogo]`,
      );
      videoOut = "vlogo";
      inputIndex++;
    }
  }

  filters.push(
    `[${videoOut}]ass=filename='${filterPath(media.assPath)}':fontsdir='${filterPath(media.fontsDir)}'[vout]`,
  );

  // Audio : voix (déjà nettoyée avant le rendu, voir lib/audio/voice.ts), musique sous la voix (ducking), puis normalisation à -14 LUFS.
  const D = plan.durationSec.toFixed(3);
  let voiceLabel: string | null = null;
  if (plan.voice && media.voicePath) {
    args.push("-ss", plan.voice.trimStart.toFixed(3), "-t", D, "-i", media.voicePath);
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${D}[voice]`,
    );
    voiceLabel = "voice";
    inputIndex++;
  }
  let musicLabel: string | null = null;
  if (plan.music) {
    const music = media.assets.get(plan.music.assetId);
    if (music) {
      args.push("-stream_loop", "-1", "-t", D, "-i", music.path);
      filters.push(
        `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${plan.music.volumeDb}dB,atrim=0:${D},afade=t=out:st=${Math.max(0, plan.durationSec - 1.5).toFixed(3)}:d=1.5[music]`,
      );
      musicLabel = "music";
      inputIndex++;
    }
  }
  if (voiceLabel && musicLabel) {
    if (plan.music?.duckUnderVoice) {
      filters.push(`[voice]asplit=2[voicemix][voicekey]`);
      filters.push(`[music][voicekey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]`);
      filters.push(`[voicemix][ducked]amix=inputs=2:normalize=0:duration=first[mix]`);
    } else {
      filters.push(`[voice][music]amix=inputs=2:normalize=0:duration=first[mix]`);
    }
  } else if (voiceLabel || musicLabel) {
    filters.push(`[${voiceLabel ?? musicLabel}]anull[mix]`);
  } else {
    args.push("-f", "lavfi", "-t", D, "-i", "anullsrc=r=48000:cl=stereo");
    filters.push(`[${inputIndex}:a]anull[mix]`);
    inputIndex++;
  }
  filters.push(
    `[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${D}[aout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    opts.preset ?? "medium",
    "-crf",
    String(opts.crf ?? 20),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-fps_mode",
    "cfr",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-t",
    D,
    "-movflags",
    "+faststart",
    outPath,
  );
  return args;
}

export type RunResult = { stdout: string; stderr: string };

/** Lance un binaire (ffmpeg/ffprobe) et suit la progression si demandé. */
export function run(
  bin: string,
  args: string[],
  opts: { onProgress?: (seconds: number) => void; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${bin} a dépassé le délai de ${opts.timeoutMs} ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (opts.onProgress) {
        const m = text.match(/out_time_us=(\d+)/g);
        if (m) {
          const last = m[m.length - 1]!.split("=")[1]!;
          opts.onProgress(Number(last) / 1e6);
        }
      }
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} a échoué (code ${code}) : ${stderr.slice(-2000)}`));
    });
  });
}
