import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { env } from "@/lib/env";
import type { SpeechToText, WordTiming } from "./types";
import { WhisperStt } from "./whisper";

/** Deepgram (nova-3, français) : horodatage mot à mot. */
export class DeepgramStt implements SpeechToText {
  constructor(private apiKey: string) {}

  async transcribe(input: { filePath: string; mime: string }): Promise<WordTiming[]> {
    const body = await readFile(input.filePath);
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=fr&punctuate=true&smart_format=true&mip_opt_out=true",
      {
        method: "POST",
        headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": input.mime || "audio/webm" },
        body,
        signal: AbortSignal.timeout(180_000),
      },
    );
    if (!res.ok)
      throw new Error(`Transcription impossible (${res.status}) : ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as {
      results?: {
        channels?: {
          alternatives?: {
            words?: { word: string; punctuated_word?: string; start: number; end: number }[];
          }[];
        }[];
      };
    };
    const words = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    return words.map((w) => ({ word: w.punctuated_word ?? w.word, start: w.start, end: w.end }));
  }
}

/**
 * Transcription simulée : répartit le texte attendu sur la durée de l'enregistrement.
 * Pour les tests et le développement hors ligne uniquement.
 */
export class MockStt implements SpeechToText {
  async transcribe(input: { expectedText?: string; durationSec: number }): Promise<WordTiming[]> {
    return estimateWords(input.expectedText ?? "", input.durationSec);
  }
}

function estimateWords(text: string, durationSec: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const usable = Math.max(0.5, durationSec - 0.6);
  const step = usable / tokens.length;
  return tokens.map((word, i) => ({
    word,
    start: Math.round((0.3 + i * step) * 100) / 100,
    end: Math.round((0.3 + i * step + step * 0.85) * 100) / 100,
  }));
}

/**
 * Vrai quand ces mots viennent de la transcription simulée (texte du script réparti sur la durée),
 * et non de l'audio. Sert à refaire la transcription des prises enregistrées avant l'arrivée
 * d'un vrai moteur de transcription.
 */
export function isEstimatedTranscript(words: WordTiming[], expectedText: string, durationSec: number) {
  const estimated = estimateWords(expectedText, durationSec);
  return (
    estimated.length === words.length &&
    estimated.every(
      (w, i) => w.word === words[i]!.word && w.start === words[i]!.start && w.end === words[i]!.end,
    )
  );
}

let instance: SpeechToText | undefined;

export function stt(): SpeechToText {
  if (instance) return instance;
  const e = env();
  if (e.STT_PROVIDER === "deepgram") {
    if (!e.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY manquante");
    instance = new DeepgramStt(e.DEEPGRAM_API_KEY);
  } else if (e.STT_PROVIDER === "whisper") {
    if (!existsSync(e.WHISPER_MODEL_PATH))
      throw new Error(`Modèle de transcription introuvable : ${e.WHISPER_MODEL_PATH}`);
    instance = new WhisperStt({
      bin: e.WHISPER_CLI_PATH,
      model: e.WHISPER_MODEL_PATH,
      ffmpeg: e.FFMPEG_PATH,
      threads: e.WHISPER_THREADS,
    });
  } else {
    if (e.NODE_ENV === "production" && process.env.ALLOW_MOCK_IN_PRODUCTION !== "1") {
      throw new Error("Transcription non configurée (STT_PROVIDER=deepgram et DEEPGRAM_API_KEY).");
    }
    instance = new MockStt();
  }
  return instance;
}

export function isRealStt(): boolean {
  return env().STT_PROVIDER !== "mock";
}

/**
 * Faut-il retranscrire la vidéo rendue pour vérifier la synchronisation ? Seulement avec un service
 * rapide (Deepgram) : en local, cela doublerait le temps de transcription pour un test qui passe
 * presque toujours, la voix du rendu étant celle qui a été transcrite.
 */
export function checksRenderedSync(): boolean {
  return env().STT_PROVIDER === "deepgram";
}

export function setStt(s: SpeechToText | undefined) {
  instance = s;
}
