import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { run } from "@/lib/render/ffmpeg";
import type { SpeechToText, WordTiming } from "./types";

type WhisperJson = {
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
};

/** Annotations que Whisper ajoute parfois à la place de la parole : [Musique], (rires), ♪… */
const NON_SPEECH = /^(\[.*\]|\(.*\)|\*.*\*|♪+)$/;
const ONLY_PUNCT = /^[\p{P}\p{S}]+$/u;

/**
 * Lit la sortie JSON de whisper-cli lancé avec « -ml 1 -sow » (un segment par mot).
 * La ponctuation isolée est recollée au mot précédent ; les horodatages sont rendus croissants.
 */
export function parseWhisperJson(raw: string): WordTiming[] {
  const json = JSON.parse(raw) as WhisperJson;
  const words: WordTiming[] = [];
  for (const seg of json.transcription ?? []) {
    const text = (seg.text ?? "").trim();
    if (!text || NON_SPEECH.test(text)) continue;
    const from = (seg.offsets?.from ?? 0) / 1000;
    const to = (seg.offsets?.to ?? 0) / 1000;
    const prev = words[words.length - 1];
    if (ONLY_PUNCT.test(text)) {
      if (prev) {
        prev.word += text;
        prev.end = Math.max(prev.end, to);
      }
      continue;
    }
    const start = Math.max(from, prev ? prev.start + 0.02 : 0);
    words.push({ word: text, start, end: Math.max(to, start + 0.05) });
  }
  // Un mot ne déborde pas sur le suivant.
  for (let i = 0; i < words.length - 1; i++) {
    const next = words[i + 1]!;
    if (words[i]!.end > next.start) words[i]!.end = next.start;
  }
  return words.map((w) => ({
    word: w.word,
    start: Math.round(w.start * 100) / 100,
    end: Math.round(w.end * 100) / 100,
  }));
}

/**
 * Transcription locale avec whisper.cpp : gratuite, sans clé, sans envoyer la voix à un service.
 * Renvoie ce qui est réellement dit, mot à mot, avec l'horodatage de chaque mot.
 */
export class WhisperStt implements SpeechToText {
  constructor(
    private opts: { bin: string; model: string; ffmpeg: string; threads?: number; language?: string },
  ) {}

  async transcribe(input: { filePath: string; durationSec: number }): Promise<WordTiming[]> {
    const dir = await mkdtemp(path.join(tmpdir(), "whisper-"));
    try {
      // whisper.cpp attend du WAV mono 16 kHz.
      const wav = path.join(dir, "voice.wav");
      await run(this.opts.ffmpeg, [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input.filePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        wav,
      ]);
      const threads = this.opts.threads || Math.max(1, Math.min(4, cpus().length));
      const outBase = path.join(dir, "out");
      await run(
        this.opts.bin,
        [
          "-m",
          this.opts.model,
          "-f",
          wav,
          "-l",
          this.opts.language ?? "fr",
          "-t",
          String(threads),
          "-ml",
          "1",
          "-sow",
          "-oj",
          "-of",
          outBase,
          "-np",
        ],
        // Environ 10 fois le temps réel au pire sur un petit serveur, et jamais moins de 2 minutes.
        { timeoutMs: Math.max(120_000, input.durationSec * 10_000) },
      );
      return parseWhisperJson(await readFile(`${outBase}.json`, "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
