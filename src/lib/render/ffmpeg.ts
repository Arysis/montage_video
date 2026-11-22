import { spawn } from "node:child_process";
import { characterInputArgs, characterOverlay, mergeIntervals } from "@/lib/character/render";
import { type EditPlan, type Motion, type PlanScene, SFX_KINDS, type SfxKind } from "@/lib/plan/schema";
import { BG_MARGIN, type BackgroundFiles, backgroundKey } from "./backgrounds";

/** Sources lavfi des bruitages (0,45 s de souffle, 0,4 s d'impact), volume déjà dosé. */
const SFX_SOURCES: Record<SfxKind, string> = {
  whoosh:
    "anoisesrc=d=0.45:c=pink:a=0.6:r=48000,highpass=f=500,lowpass=f=4500,afade=t=in:d=0.3:curve=qsin,afade=t=out:st=0.3:d=0.15,volume=-14dB",
  hit: "aevalsrc='0.9*sin(2*PI*(45+140*exp(-t*28))*t)*exp(-t*9)':d=0.4:s=48000,volume=-9dB",
};

export type ResolvedMedia = {
  /** Chemin local de chaque asset du plan (vidéo, image, musique, logo en PNG). */
  assets: Map<string, { path: string; kind: string }>;
  voicePath: string | null;
  assPath: string;
  fontsDir: string;
  /** Liste concat des poses de chaque personnage animé (par id de son image principale). */
  characters?: Map<string, string>;
  /** Images des fonds animés (par backgroundKey), dessinées avant le rendu. */
  backgrounds?: Map<string, BackgroundFiles>;
  /** Piste des bruitages, préparée par buildSfxTrackArgs. */
  sfxPath?: string | null;
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
 * Fond animé aux couleurs de la marque. L'image est dessinée à l'avance (voir backgrounds.ts)
 * et ne fait que dériver lentement : uniquement des filtres de base (crop, overlay), qui
 * marchent pareil sur toutes les versions de FFmpeg.
 */
export function generatedBackground(
  v: Generated,
  files: BackgroundFiles | undefined,
  o: { W: number; H: number; fps: number; dur: number; label: string; nextInput: number },
): { args: string[]; filters: string[]; inputs: number } {
  const d = o.dur.toFixed(3);
  if (!files) {
    return {
      args: [],
      filters: [`color=c=${hex0x(v.colors[1] ?? "#0E0F11")}:s=${o.W}x${o.H}:r=${o.fps}:d=${d}[${o.label}]`],
      inputs: 0,
    };
  }
  const loop = (file: string) => ["-loop", "1", "-framerate", String(o.fps), "-t", d, "-i", file];
  const bw = Math.round((o.W * BG_MARGIN) / 2) * 2;
  const bh = Math.round((o.H * BG_MARGIN) / 2) * 2;
  const phase = (v.seed % 7) * 0.9;
  const args = loop(files.image);
  const filters = [
    `[${o.nextInput}:v]scale=${bw}:${bh},crop=${o.W}:${o.H}:x='(iw-ow)/2*(1+0.9*sin(t*0.35+${phase}))':y='(ih-oh)/2*(1+0.9*cos(t*0.27+${phase}))',format=yuv420p[${o.label}${files.particles ? "b" : ""}]`,
  ];
  if (files.particles) {
    args.push(...loop(files.particles));
    filters.push(
      `[${o.nextInput + 1}:v]scale=${o.W}:${o.H * 2},format=rgba[${o.label}p]`,
      `[${o.label}b][${o.label}p]overlay=x=0:y='-mod(t*${Math.round(o.H / 12)},${o.H})':shortest=1,format=yuv420p[${o.label}]`,
    );
  }
  return { args, filters, inputs: files.particles ? 2 : 1 };
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
 * Incrustation fixe du personnage de la scène (centré en bas, sous les sous-titres), pour un
 * personnage qui n'est pas animé. Les personnages animés (plan.characterRigs) sont incrustés
 * plus loin, sur toute la vidéo, par le module personnage.
 */
export function staticCharacterOverlay(p: {
  plan: EditPlan;
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
  if (!p.scene.character || p.plan.characterRigs?.[p.scene.character.assetId]) return null;
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
      const bg = generatedBackground(visual, media.backgrounds?.get(backgroundKey(visual)), {
        W,
        H,
        fps,
        dur: clipDur,
        label: `${base}g`,
        nextInput: inputIndex,
      });
      args.push(...bg.args);
      filters.push(...bg.filters);
      inputIndex += bg.inputs;
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
    const overlay = staticCharacterOverlay({
      plan,
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

  // Personnages animés : par-dessus le fond, sous le logo et les sous-titres.
  Object.entries(plan.characterRigs ?? {}).forEach(([id, rig], k) => {
    const list = media.characters?.get(id);
    const visible = mergeIntervals(plan.scenes.filter((s) => s.character?.assetId === id));
    if (!list || !visible.length) return;
    args.push(...characterInputArgs(list));
    filters.push(
      ...characterOverlay({
        rig,
        inputIndex,
        videoIn: videoOut,
        out: `vchar${k}`,
        label: `char${k}`,
        fps,
        scale,
        visible,
      }),
    );
    videoOut = `vchar${k}`;
    inputIndex++;
  });

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
  // Bruitages (souffle sur les transitions, impact sur les zooms chocs). La piste est préparée à part (buildSfxTrackArgs) : mélangée ici dans le même graphe, la
  // chaîne asplit/adelay/amix des bruitages bloque FFmpeg indéfiniment.
  let sfxLabel: string | null = null;
  if (media.sfxPath && plan.sfx?.length) {
    args.push("-i", media.sfxPath);
    filters.push(`[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[sfx]`);
    sfxLabel = "sfx";
    inputIndex++;
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
  let mixLabel = "mix";
  if (sfxLabel) {
    filters.push(`[mix][${sfxLabel}]amix=inputs=2:normalize=0:duration=first[mixfx]`);
    mixLabel = "mixfx";
  }
  filters.push(
    `[${mixLabel}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${D}[aout]`,
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

/**
 * Commande FFmpeg qui fabrique la piste des bruitages (WAV) : chaque son est synthétisé
 * (aucun fichier, aucune clé) puis placé à son instant. Null si le plan n'en a pas.
 */
export function buildSfxTrackArgs(plan: EditPlan, out: string): string[] | null {
  const sfx = (plan.sfx ?? []).filter((x) => x.at < plan.durationSec - 0.1);
  if (!sfx.length) return null;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
  const filters: string[] = [];
  const delayed: string[] = [];
  let input = 0;
  for (const kind of SFX_KINDS) {
    const list = sfx.filter((x) => x.kind === kind);
    if (!list.length) continue;
    args.push("-f", "lavfi", "-i", SFX_SOURCES[kind]);
    const outs = list.map((_, j) => `${kind}${j}`);
    filters.push(
      `[${input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${list.length}${outs.map((o) => `[${o}s]`).join("")}`,
    );
    list.forEach((x, j) => {
      const ms = Math.round(x.at * 1000);
      filters.push(`[${outs[j]}s]adelay=${ms}|${ms}[${outs[j]}]`);
      delayed.push(outs[j]!);
    });
    input++;
  }
  filters.push(
    `${delayed.map((d) => `[${d}]`).join("")}amix=inputs=${delayed.length}:normalize=0:duration=longest[out]`,
  );
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", "48000", out);
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
