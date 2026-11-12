import { spawn } from "node:child_process";
import type { EditPlan, Motion, PlanScene } from "@/lib/plan/schema";

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

/** Mélange deux couleurs #RRGGBB (t = 0 : a, t = 1 : b). */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) * (1 - t) + ch(b, i) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

type Generated = Extract<PlanScene["visual"], { type: "generated" }>;

/**
 * Fond animé aux couleurs de la marque, calculé par FFmpeg (aucun fichier, aucun appel à l'IA).
 * Calculé en basse définition puis agrandi : flou naturel et rendu rapide.
 */
export function generatedBackground(
  v: Generated,
  o: { W: number; H: number; fps: number; dur: number; label: string },
): string[] {
  const [primary, background, accent = primary] = v.colors as [string, string, string?];
  const w = Math.max(64, Math.round(o.W / 4));
  const h = Math.max(64, Math.round(o.H / 4));
  const d = o.dur.toFixed(3);
  const common = `s=${w}x${h}:rate=${o.fps}:duration=${d}:seed=${v.seed}`;
  const up = `scale=${o.W}:${o.H}:flags=bicubic`;
  const c = (hex: string) => hex0x(hex);
  switch (v.style) {
    case "nuit":
      return [
        `gradients=${common}:c0=${c(background)}:c1=${c(mixHex(background, primary, 0.28))}:c2=${c(background)}:c3=${c(mixHex(background, accent, 0.18))}:nb_colors=4:speed=0.015,gblur=sigma=28,${up},noise=c0s=7:allf=t,vignette=PI/5,format=yuv420p[${o.label}]`,
      ];
    case "degrade":
      return [
        `gradients=${common}:c0=${c(primary)}:c1=${c(mixHex(primary, accent, 0.5))}:c2=${c(accent)}:nb_colors=3:speed=0.02,gblur=sigma=12,${up},noise=c0s=5:allf=t,format=yuv420p[${o.label}]`,
      ];
    case "particules":
      return [
        `gradients=${common}:c0=${c(background)}:c1=${c(mixHex(background, primary, 0.22))}:c2=${c(background)}:nb_colors=3:speed=0.015,gblur=sigma=20,${up},format=yuv420p[${o.label}g]`,
        `color=c=${c(mixHex(primary, "#FFFFFF", 0.2))}:s=${o.W}x${o.H}:r=${o.fps}:d=${d},format=yuva420p[${o.label}c]`,
        `life=s=${Math.round(w / 2.5)}x${Math.round(h / 2.5)}:mold=12:rate=${o.fps}:ratio=0.06:seed=${v.seed}:death_color=black:life_color=white:mold_color=0x404040,trim=duration=${d},gblur=sigma=2.5,${up},format=gray[${o.label}m]`,
        `[${o.label}c][${o.label}m]alphamerge[${o.label}p]`,
        `[${o.label}g][${o.label}p]overlay=shortest=1,vignette=PI/5,format=yuv420p[${o.label}]`,
      ];
    default:
      return [
        `gradients=${common}:c0=${c(primary)}:c1=${c(background)}:c2=${c(accent)}:c3=${c(background)}:nb_colors=4:speed=0.025,gblur=sigma=45,${up},noise=c0s=6:allf=t,format=yuv420p[${o.label}]`,
      ];
  }
}

/** Expressions zoompan : mouvement lent, zooms chocs et secousse. */
export function cameraExpressions(
  motion: Motion,
  frames: number,
  fps: number,
  punches: number[],
  shake: boolean,
): { z: string; x: string; y: string } | null {
  if (motion === "none" && !punches.length && !shake) return null;
  const F = Math.max(1, frames);
  let z =
    motion === "zoom-in"
      ? `(1+0.12*on/${F})`
      : motion === "zoom-out"
        ? `(1.12-0.12*on/${F})`
        : motion === "pan-left" || motion === "pan-right"
          ? "1.15"
          : "1";
  const hold = Math.round(0.5 * fps);
  if (punches.length) {
    const terms = punches.map((p) => {
      const a = Math.round(p * fps);
      return `between(on,${a},${a + hold})`;
    });
    z = `${z}*(1+0.14*min(1,${terms.join("+")}))`;
  }
  const shakeFrames = Math.round(0.4 * fps);
  if (shake) z = `${z}*(1+0.06*lt(on,${shakeFrames}))`;
  let x =
    motion === "pan-left"
      ? `(iw-iw/zoom)*(1-on/${F})`
      : motion === "pan-right"
        ? `(iw-iw/zoom)*on/${F}`
        : "iw/2-(iw/zoom/2)";
  let y = "ih/2-(ih/zoom/2)";
  if (shake) {
    x = `${x}+lt(on,${shakeFrames})*sin(on*2.7)*iw*0.012`;
    y = `${y}+lt(on,${shakeFrames})*cos(on*3.1)*ih*0.008`;
  }
  return { z, x, y };
}

export type OverlayParts = { args: string[]; filters: string[]; label: string; inputs: number };

/**
 * Incrustation du personnage de la scène (image fixe, centrée en bas, sous les sous-titres).
 * Point d'extension : le module « personnage qui parle » remplace ce rendu par une bouche animée.
 */
export function characterOverlay(p: {
  scene: PlanScene;
  index: number;
  baseLabel: string;
  nextInput: number;
  media: ResolvedMedia;
  W: number;
  H: number;
  fps: number;
  clipDur: number;
}): OverlayParts | null {
  if (!p.scene.character) return null;
  const file = p.media.assets.get(p.scene.character.assetId);
  if (!file) return null;
  const h = Math.round((p.H * 0.6) / 2) * 2;
  const label = `ch${p.index}`;
  return {
    args: ["-loop", "1", "-framerate", String(p.fps), "-t", p.clipDur.toFixed(3), "-i", file.path],
    filters: [
      `[${p.nextInput}:v]scale=-2:${h},format=rgba[${label}i]`,
      `[${p.baseLabel}][${label}i]overlay=x=(W-w)/2:y=H-h-${Math.round(p.H * 0.08)}:shortest=1,format=yuv420p,settb=1/${p.fps}[${label}]`,
    ],
    label,
    inputs: 1,
  };
}

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
  const frameAt = (t: number) => Math.round(t * fps);

  const clips: { label: string; frames: number }[] = [];
  plan.scenes.forEach((scene, k) => {
    const tail = scene.transition.type === "cut" ? 0 : frameAt(scene.transition.duration);
    const frames = Math.max(1, frameAt(scene.end) - frameAt(scene.start) + tail);
    const clipDur = frames / fps;
    const base = `b${k}`;
    const finish = `fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${clipDur.toFixed(3)},trim=end_frame=${frames},setpts=PTS-STARTPTS,settb=1/${fps}`;
    const visual = scene.visual;
    if (visual.type === "color") {
      filters.push(
        `color=c=${hex0x(visual.color)}:s=${W}x${H}:r=${fps}:d=${clipDur.toFixed(3)},setsar=1,${finish}[${base}]`,
      );
    } else if (visual.type === "generated") {
      filters.push(...generatedBackground(visual, { W, H, fps, dur: clipDur, label: `${base}g` }));
      filters.push(`[${base}g]setsar=1,${finish}[${base}]`);
    } else {
      const asset = media.assets.get(visual.assetId);
      if (!asset) throw new Error(`Asset absent pour la scène ${scene.id}`);
      const isVideo = asset.kind === "video";
      if (isVideo) {
        args.push("-ss", visual.sourceStart.toFixed(3), "-t", (clipDur + 0.5).toFixed(3), "-i", asset.path);
      } else {
        args.push("-i", asset.path);
      }
      const cam = cameraExpressions(visual.motion, frames, fps, scene.punches, scene.shake);
      // Les images et les mouvements sont calculés en double résolution pour éviter les saccades.
      const m = !isVideo || cam ? 2 : 1;
      const w2 = W * m;
      const h2 = H * m;
      let chain: string;
      if (visual.fit === "contain") {
        // Le fichier en entier, posé sur une version floue et assombrie de lui-même.
        filters.push(`[${inputIndex}:v]setsar=1,split=2[${base}a][${base}f]`);
        filters.push(
          `[${base}a]scale=${Math.round(w2 / 8)}:${Math.round(h2 / 8)}:force_original_aspect_ratio=increase,crop=${Math.round(w2 / 8)}:${Math.round(h2 / 8)},gblur=sigma=6,scale=${w2}:${h2},eq=brightness=-0.12:saturation=1.2[${base}bl]`,
        );
        filters.push(`[${base}f]scale=${w2}:${h2}:force_original_aspect_ratio=decrease[${base}fg]`);
        filters.push(`[${base}bl][${base}fg]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1[${base}c]`);
        chain = `[${base}c]`;
      } else {
        chain = `[${inputIndex}:v]scale=${w2}:${h2}:force_original_aspect_ratio=increase,crop=${w2}:${h2},setsar=1,`;
      }
      const zoom = cam
        ? isVideo
          ? `fps=${fps},zoompan=z='${cam.z}':x='${cam.x}':y='${cam.y}':d=1:s=${W}x${H}:fps=${fps}`
          : `zoompan=z='${cam.z}':x='${cam.x}':y='${cam.y}':d=${frames}:s=${W}x${H}:fps=${fps}`
        : isVideo
          ? `fps=${fps}`
          : `scale=${W}:${H}`;
      // tpad clone : si le rush est plus court que le plan, on fige la dernière image au lieu d'un trou.
      filters.push(`${chain}${zoom},${finish}[${base}]`);
      inputIndex++;
    }
    let label = base;
    const overlay = characterOverlay({
      scene,
      index: k,
      baseLabel: base,
      nextInput: inputIndex,
      media,
      W,
      H,
      fps,
      clipDur,
    });
    if (overlay) {
      args.push(...overlay.args);
      filters.push(...overlay.filters);
      inputIndex += overlay.inputs;
      label = overlay.label;
    }
    clips.push({ label, frames });
  });

  // Assemblage : coupe franche (concat) ou transition (xfade) qui démarre pile au début du plan suivant.
  let current = clips[0]!.label;
  for (let k = 1; k < clips.length; k++) {
    const prev = plan.scenes[k - 1]!;
    const out = `j${k}`;
    if (prev.transition.type === "cut") {
      filters.push(`[${current}][${clips[k]!.label}]concat=n=2:v=1:a=0,settb=1/${fps}[${out}]`);
    } else {
      const offset = frameAt(plan.scenes[k]!.start) / fps;
      const duration = frameAt(prev.transition.duration) / fps;
      filters.push(
        `[${current}][${clips[k]!.label}]xfade=transition=${prev.transition.type}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)},settb=1/${fps}[${out}]`,
      );
    }
    current = out;
  }
  let videoOut = current;

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

  // Audio : voix nettoyée, musique sous la voix (ducking), puis normalisation à -14 LUFS.
  const D = plan.durationSec.toFixed(3);
  let voiceLabel: string | null = null;
  if (plan.voice && media.voicePath) {
    args.push("-ss", plan.voice.trimStart.toFixed(3), "-t", D, "-i", media.voicePath);
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,highpass=f=80,afftdn=nf=-25,apad,atrim=0:${D}[voice]`,
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
