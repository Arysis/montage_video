export type WordTiming = { word: string; start: number; end: number };

export interface SpeechToText {
  /** Transcrit un fichier audio ou vidéo et renvoie chaque mot avec son horodatage (secondes). */
  transcribe(input: {
    filePath: string;
    mime: string;
    expectedText?: string;
    durationSec: number;
  }): Promise<WordTiming[]>;
}
