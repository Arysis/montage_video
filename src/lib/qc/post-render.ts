import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { run } from "@/lib/render/ffmpeg";
import type { EditPlan } from "@/lib/plan/schema";
import { buildCues } from "@/lib/plan/subtitles";
import { alignWords, normalizeToken } from "@/lib/plan/align";
import type { WordTiming } from "@/lib/stt/types";
import type { QcCheck } from "./types";

export type Probe = {
  durationSec: number;
  sizeBytes: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    rFrameRate: string;
    avgFrameRate: string;
    frames: number;
  };
  audio?: { codec: string; sampleRate: number; channels: number };
};

const fmt = (n: number, d = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });
const ratio = (r: string) => {
  const [a, b] = r.split("/").map(Number);
  return b ? a! / b : a!;
};

export async function probe(ffprobe: string, file: string): Promise<Probe> {
  const { stdout } = await run(ffprobe, [
    "-v",
    "error",
    "-count_packets",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_packets,sample_rate,channels",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    format: { duration: string; size: string };
    streams: Record<string, string | number>[];
  };
  const v = json.streams.find((s) => s.codec_type === "video");
  const a = json.streams.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(json.format.duration),
    sizeBytes: Number(json.format.size),
    video: v
      ? {
          codec: String(v.codec_name),
          width: Number(v.width),
          height: Number(v.height),
          rFrameRate: String(v.r_frame_rate),
          avgFrameRate: String(v.avg_frame_rate),
          frames: Number(v.nb_read_packets),
        }
      : undefined,
    audio: a
      ? { codec: String(a.codec_name), sampleRate: Number(a.sample_rate), channels: Number(a.channels) }
      : undefined,
  };
}

/** Test 5 : fichier lisible, résolution et format attendus, images par seconde constantes, durée exacte. */
export function checkTechnical(plan: EditPlan, p: Probe): QcCheck[] {
  const problems: string[] = [];
  if (!p.video) problems.push("pas de piste vidéo");
  if (!p.audio) problems.push("pas de piste audio");
  if (p.video) {
    if (p.video.codec !== "h264") problems.push(`codec ${p.video.codec}`);
    if (p.video.width !== plan.width || p.video.height !== plan.height)
      problems.push(`${p.video.width}×${p.video.height} au lieu de ${plan.width}×${plan.height}`);
    const r = ratio(p.video.rFrameRate);
    const avg = ratio(p.video.avgFrameRate);
    if (Math.abs(r - plan.fps) > 0.01 || Math.abs(avg - plan.fps) > 0.05)
      problems.push("images par seconde variables");
    const expected = Math.round(plan.durationSec * plan.fps);
    if (Math.abs(p.video.frames - expected) > 2)
      problems.push(`${p.video.frames} images au lieu de ${expected}`);
  }
  if (Math.abs(p.durationSec - plan.durationSec) > 0.15)
    problems.push(`durée ${fmt(p.durationSec, 2)} s au lieu de ${fmt(plan.durationSec, 2)} s`);
  return [
    problems.length
      ? {
          key: "technical:file",
          testId: "technical",
          status: "fail",
          title: "Fichier vidéo non conforme",
          detail: problems.join(", "),
        }
      : {
          key: "technical:file",
          testId: "technical",
          status: "pass",
          title: `Fichier conforme (${plan.width}×${plan.height}, ${plan.fps} i/s)`,
        },
  ];
}

export type FrameAnalysis = {
  black: { start: number; end: number }[];
  freeze: { start: number; end: number }[];
  flashes: number[];
};

export function parseFrameAnalysis(stderr: string, metadata: string): FrameAnalysis {
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }));
  const freezeStarts = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const freezeEnds = [...stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const freeze = freezeStarts.map((start, i) => ({ start, end: freezeEnds[i] ?? Number.POSITIVE_INFINITY }));
  const flashes: number[] = [];
  let prev: number | null = null;
  let t = 0;
  for (const line of metadata.split("\n")) {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) t = Number(tm[1]);
    const ym = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (ym) {
      const y = Number(ym[1]);
      if (prev !== null && Math.abs(y - prev) > 110) flashes.push(t);
      prev = y;
    }
  }
  return { black, freeze, flashes };
}

export async function analyzeFrames(ffmpeg: string, file: string): Promise<FrameAnalysis> {
  const metaFile = path.join(tmpdir(), `qc-${randomUUID()}.txt`);
  try {
    const { stderr } = await run(ffmpeg, [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "info",
      "-i",
      file,
      "-vf",
      `scale=270:-2,fps=10,blackdetect=d=0.5:pix_th=0.08,freezedetect=n=0.002:d=1.5,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${metaFile.replace(/:/g, "\\:")}`,
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const meta = await readFile(metaFile, "utf8").catch(() => "");
    return parseFrameAnalysis(stderr, meta);
  } finally {
    await rm(metaFile, { force: true });
  }
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start);

/** Test 6 : pas d'écran noir ou figé inattendu, pas de flash brutal. */
export function checkFrames(plan: EditPlan, a: FrameAnalysis): QcCheck[] {
  const checks: QcCheck[] = [];
  // Un fond de couleur sombre voulu par le plan n'est pas un écran noir accidentel.
  const intendedDark = plan.scenes.filter((s) => s.visual.type === "color");
  const unexpectedBlack = a.black.filter(
    (b) => !intendedDark.some((s) => overlaps(b, s) >= (b.end - b.start) * 0.8),
  );
  const sceneAt = (t: number) => plan.scenes.find((s) => t >= s.start && t < s.end);
  if (unexpectedBlack.length) {
    const b = unexpectedBlack[0]!;
    checks.push({
      key: "frames:black",
      testId: "frames",
      status: "fail",
      title: "Écran noir inattendu",
      detail: `De ${fmt(b.start)} s à ${fmt(b.end)} s.`,
      sceneId: sceneAt(b.start)?.id,
    });
  } else {
    checks.push({ key: "frames:black", testId: "frames", status: "pass", title: "Aucun écran noir" });
  }
  // Une image fixe est figée par nature : seul un rush vidéo figé est suspect.
  const videoScenes = plan.scenes.filter((s) => s.visual.type === "asset" && s.visual.motion === "none");
  const frozen = a.freeze.filter((f) =>
    videoScenes.some((s) => overlaps(f, s) > 1.5 && s.visual.type === "asset"),
  );
  checks.push(
    frozen.length
      ? {
          key: "frames:freeze",
          testId: "frames",
          status: "warn",
          title: "Image figée dans un plan vidéo",
          detail: `À ${fmt(frozen[0]!.start)} s.`,
          sceneId: sceneAt(frozen[0]!.start)?.id,
        }
      : { key: "frames:freeze", testId: "frames", status: "pass", title: "Aucune image figée inattendue" },
  );
  checks.push(
    a.flashes.length
      ? {
          key: "frames:flash",
          testId: "frames",
          status: "warn",
          title: "Changement de luminosité brutal",
          detail: `À ${fmt(a.flashes[0]!)} s.`,
          sceneId: sceneAt(a.flashes[0]!)?.id,
        }
      : { key: "frames:flash", testId: "frames", status: "pass", title: "Aucun flash brutal" },
  );
  return checks;
}

export type AudioAnalysis = {
  integratedLufs: number;
  truePeakDb: number;
  silences: { start: number; end: number }[];
};

export function parseAudioAnalysis(stderr: string): AudioAnalysis {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/);
  const peak = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  const silenceStarts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const silenceEnds = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return {
    integratedLufs: i && i[1] !== "-inf" ? Number(i[1]) : Number.NEGATIVE_INFINITY,
    truePeakDb: peak && peak[1] !== "-inf" ? Number(peak[1]) : Number.NEGATIVE_INFINITY,
    silences: silenceStarts.map((start, k) => ({
      start: Math.max(0, start),
      end: silenceEnds[k] ?? Number.POSITIVE_INFINITY,
    })),
  };
}

export async function analyzeAudio(ffmpeg: string, file: string): Promise<AudioAnalysis> {
  const { stderr } = await run(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "info",
    "-i",
    file,
    "-af",
    "silencedetect=noise=-45dB:d=1.5,ebur128=peak=true",
    "-vn",
    "-f",
    "null",
    "-",
  ]);
  return parseAudioAnalysis(stderr);
}

/** Test 7 : pas de silence anormal, pas de saturation, volume normalisé (-14 LUFS), musique sous la voix. */
export function checkAudio(plan: EditPlan, a: AudioAnalysis): QcCheck[] {
  const checks: QcCheck[] = [];
  const delta = Math.abs(a.integratedLufs - -14);
  checks.push({
    key: "audio:loudness",
    testId: "audio",
    status: delta <= 2 ? "pass" : delta <= 4 ? "warn" : "fail",
    title: delta <= 2 ? "Volume adapté aux réseaux" : "Volume mal réglé",
    detail: `${Number.isFinite(a.integratedLufs) ? fmt(a.integratedLufs) : "silence"} LUFS, cible -14.`,
  });
  checks.push({
    key: "audio:peak",
    testId: "audio",
    status: a.truePeakDb <= -0.5 ? "pass" : "warn",
    title: a.truePeakDb <= -0.5 ? "Pas de saturation" : "Son qui sature",
    detail: Number.isFinite(a.truePeakDb) ? `Crête ${fmt(a.truePeakDb)} dB.` : undefined,
  });
  // Les silences au tout début ou à la toute fin sont normaux.
  const inner = a.silences.filter((s) => s.start > 0.5 && s.end < plan.durationSec - 0.5);
  const longest = inner.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  checks.push(
    longest > 3
      ? {
          key: "audio:silence",
          testId: "audio",
          status: "fail",
          title: "Silence anormal",
          detail: `${fmt(longest)} s sans son.`,
        }
      : longest > 1.5
        ? {
            key: "audio:silence",
            testId: "audio",
            status: "warn",
            title: "Blanc dans le son",
            detail: `${fmt(longest)} s sans son.`,
          }
        : { key: "audio:silence", testId: "audio", status: "pass", title: "Pas de silence anormal" },
  );
  if (plan.music) {
    const ok = plan.music.volumeDb <= -12 || plan.music.duckUnderVoice;
    checks.push({
      key: "audio:music",
      testId: "audio",
      status: ok ? "pass" : "warn",
      title: ok ? "Musique sous le niveau de la voix" : "Musique trop forte",
    });
  }
  return checks;
}

/**
 * Test 8 : sous-titres alignés sur la voix.
 * Vérifie toujours la cohérence interne ; compare à une nouvelle transcription du MP4 quand elle existe.
 */
export function checkSync(plan: EditPlan, renderedWords: WordTiming[] | null): QcCheck[] {
  const cues = buildCues(plan);
  const broken = cues.some((c, i) => c.end <= c.start || (i > 0 && c.start < cues[i - 1]!.end - 0.01));
  const outOfRange = plan.subtitles.words.some((w) => w.end > plan.durationSec + 0.05);
  if (broken || outOfRange) {
    return [{ key: "sync:subtitles", testId: "sync", status: "fail", title: "Sous-titres mal placés" }];
  }
  if (!renderedWords) {
    return [
      {
        key: "sync:subtitles",
        testId: "sync",
        status: "pass",
        title: "Sous-titres synchronisés",
        detail: "Calés sur la transcription de ta voix.",
      },
    ];
  }
  const planTokens = plan.subtitles.words.map((w) => normalizeToken(w.word));
  const heard = renderedWords.map((w) => normalizeToken(w.word));
  const map = alignWords(planTokens, heard);
  const offsets: number[] = [];
  map.forEach((j, i) => {
    if (j >= 0) offsets.push(Math.abs(plan.subtitles.words[i]!.start - renderedWords[j]!.start));
  });
  if (offsets.length < Math.max(3, planTokens.length * 0.5)) {
    return [
      {
        key: "sync:subtitles",
        testId: "sync",
        status: "warn",
        title: "Voix difficile à reconnaître",
        detail: "Moins de la moitié des mots retrouvés dans la vidéo finale.",
      },
    ];
  }
  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)]!;
  return [
    {
      key: "sync:subtitles",
      testId: "sync",
      status: median <= 0.2 ? "pass" : median <= 0.4 ? "warn" : "fail",
      title: median <= 0.2 ? "Sous-titres synchronisés" : "Sous-titres en décalage",
      detail: `Décalage médian ${fmt(median * 1000, 0)} ms.`,
    },
  ];
}

/** Extrait une image au milieu de chaque scène (pour la relecture par l'IA). */
export async function extractSceneFrames(
  ffmpeg: string,
  file: string,
  plan: EditPlan,
  outDir: string,
): Promise<{ sceneId: string; path: string }[]> {
  const frames: { sceneId: string; path: string }[] = [];
  for (const scene of plan.scenes.slice(0, 12)) {
    const t = (scene.start + scene.end) / 2;
    const out = path.join(outDir, `frame-${scene.id}.jpg`);
    await run(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      t.toFixed(2),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=540:-2",
      "-q:v",
      "4",
      out,
    ]);
    frames.push({ sceneId: scene.id, path: out });
  }
  return frames;
}
