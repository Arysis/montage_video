import { describe, expect, it } from "vitest";
import { VOICE_TARGET_LUFS, voiceCleanFilter, voiceGain } from "@/lib/audio/voice";
import { isEstimatedTranscript, MockStt } from "@/lib/stt";
import { parseWhisperJson } from "@/lib/stt/whisper";

describe("nettoyage de la voix", () => {
  it("débruite avec RNNoise quand le modèle est là, sinon avec le débruiteur FFT", () => {
    const rnn = voiceCleanFilter({ rnnModelPath: "/opt/rnnoise/voice.rnnn" });
    expect(rnn).toContain("arnndn=m=/opt/rnnoise/voice.rnnn");
    expect(rnn).toContain("afftdn");
    const fft = voiceCleanFilter();
    expect(fft).not.toContain("arnndn");
    expect(fft).toContain("afftdn");
    for (const f of [rnn, fft]) {
      expect(f).toContain("highpass");
      expect(f).toContain("equalizer");
      expect(f).toContain("deesser");
      expect(f).toContain("acompressor");
      expect(f).toContain("alimiter");
      // La normalisation dynamique ferait remonter le bruit dans les pauses.
      expect(f).not.toContain("loudnorm");
    }
  });

  it("ignore un chemin de modèle qu'il faudrait échapper", () => {
    expect(voiceCleanFilter({ rnnModelPath: "/tmp/a:b,c.rnnn" })).not.toContain("arnndn");
  });

  it("ramène la voix à -16 LUFS avec un gain borné", () => {
    expect(voiceGain(-30)).toBe(VOICE_TARGET_LUFS + 30);
    expect(voiceGain(-50)).toBe(18);
    expect(voiceGain(-5)).toBe(-11);
    expect(voiceGain(-Infinity)).toBe(0);
    expect(voiceGain(Number.NaN)).toBe(0);
  });
});

describe("transcription locale (whisper.cpp)", () => {
  const seg = (text: string, from: number, to: number) => ({ offsets: { from, to }, text });

  it("garde chaque mot dit avec son horodatage", () => {
    const words = parseWhisperJson(
      JSON.stringify({
        transcription: [
          seg(" Bonjour", 320, 780),
          seg(",", 780, 800),
          seg(" voici", 900, 1210),
          seg(" l'IA", 1210, 1600),
          seg(" !", 1600, 1650),
        ],
      }),
    );
    expect(words).toEqual([
      { word: "Bonjour,", start: 0.32, end: 0.8 },
      { word: "voici", start: 0.9, end: 1.21 },
      { word: "l'IA!", start: 1.21, end: 1.65 },
    ]);
  });

  it("retire les annotations qui ne sont pas de la parole", () => {
    const words = parseWhisperJson(
      JSON.stringify({
        transcription: [seg(" [Musique]", 0, 900), seg(" Salut", 1000, 1400), seg(" (rires)", 1400, 2000)],
      }),
    );
    expect(words.map((w) => w.word)).toEqual(["Salut"]);
  });

  it("rend les horodatages croissants et sans chevauchement", () => {
    const words = parseWhisperJson(
      JSON.stringify({
        transcription: [seg(" un", 1000, 1500), seg(" deux", 900, 1200), seg(" trois", 1300, 1300)],
      }),
    );
    for (let i = 0; i < words.length; i++) {
      expect(words[i]!.end).toBeGreaterThan(words[i]!.start);
      if (i > 0) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
    }
  });

  it("accepte une transcription vide", () => {
    expect(parseWhisperJson(JSON.stringify({ transcription: [] }))).toEqual([]);
    expect(parseWhisperJson("{}")).toEqual([]);
  });
});

describe("prises transcrites avant le vrai moteur", () => {
  it("reconnaît les mots estimés à partir du script", async () => {
    const text = "Bonjour à tous, voici la démo.";
    const estimated = await new MockStt().transcribe({ expectedText: text, durationSec: 4 });
    expect(isEstimatedTranscript(estimated, text, 4)).toBe(true);
    const real = estimated.map((w, i) => (i === 1 ? { ...w, start: w.start + 0.07 } : w));
    expect(isEstimatedTranscript(real, text, 4)).toBe(false);
    expect(isEstimatedTranscript(estimated.slice(1), text, 4)).toBe(false);
  });
});
