import { z } from "zod";

/**
 * Configuration lue depuis les variables d'environnement.
 * Toute valeur absente qui est indispensable en production fait échouer le démarrage.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("[Nom de l'app]"),
  /** Secret pour signer les liens de fichiers. 32 caractères au moins en production. */
  APP_SECRET: z.string().min(16).default("dev-secret-change-me-please"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/montage"),

  // Stockage des fichiers : "local" (disque) ou "s3" (S3, Cloudflare R2, Scaleway...)
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // IA : "anthropic" en production, "mock" pour les tests et le développement hors ligne
  AI_PROVIDER: z.enum(["anthropic", "mock"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),

  // Transcription mot à mot de la voix (sous-titres) : "whisper" (local, gratuit, inclus dans l'image
  // Docker), "deepgram" (service en ligne, plus rapide) ou "mock" (texte du script, timings estimés)
  STT_PROVIDER: z.enum(["whisper", "deepgram", "mock"]).default("mock"),
  DEEPGRAM_API_KEY: z.string().optional(),
  WHISPER_CLI_PATH: z.string().default("whisper-cli"),
  WHISPER_MODEL_PATH: z.string().default("/opt/whisper/model.bin"),
  /** 0 : choisi selon le nombre de processeurs (4 au plus). */
  WHISPER_THREADS: z.coerce.number().int().min(0).default(0),
  /** Modèle RNNoise pour débruiter la voix ; sans lui, débruitage FFT seul. */
  VOICE_DENOISE_MODEL: z.string().default("/opt/rnnoise/voice.rnnn"),

  // Publication sur les réseaux : "ayrshare" ou "mock"
  PUBLISH_PROVIDER: z.enum(["ayrshare", "mock"]).default("mock"),
  AYRSHARE_API_KEY: z.string().optional(),

  // E-mails transactionnels (mot de passe oublié) : "resend" ou "log"
  EMAIL_PROVIDER: z.enum(["resend", "log"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("[Nom de l'app] <no-reply@example.com>"),

  // Paiement
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_CREATOR: z.string().optional(),

  // Offres : valeurs à définir par le produit (voir README)
  FREE_VIDEOS_PER_MONTH: z.coerce.number().int().positive().default(3),
  CREATOR_VIDEOS_PER_MONTH: z.coerce.number().int().positive().default(30),
  FREE_MAX_DURATION_SEC: z.coerce.number().int().positive().default(60),
  CREATOR_MAX_DURATION_SEC: z.coerce.number().int().positive().default(90),
  FREE_WATERMARK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  FONTS_DIR: z.string().default("assets/fonts"),
  WORK_DIR: z.string().default(".data/work"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Configuration invalide : ${parsed.error.message}`);
  }
  const e = parsed.data;
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (e.NODE_ENV === "production" && !building && process.env.SKIP_ENV_CHECK !== "1") {
    const missing: string[] = [];
    if (e.APP_SECRET.length < 32 || e.APP_SECRET.startsWith("dev-secret"))
      missing.push("APP_SECRET (32 caractères au moins)");
    if (e.AI_PROVIDER === "anthropic" && !e.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
    if (e.STT_PROVIDER === "deepgram" && !e.DEEPGRAM_API_KEY) missing.push("DEEPGRAM_API_KEY");
    if (e.PUBLISH_PROVIDER === "ayrshare" && !e.AYRSHARE_API_KEY) missing.push("AYRSHARE_API_KEY");
    if (e.EMAIL_PROVIDER === "resend" && !e.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (e.STORAGE_DRIVER === "s3") {
      for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!e[k]) missing.push(k);
      }
    }
    if (missing.length) throw new Error(`Variables manquantes en production : ${missing.join(", ")}`);
  }
  cached = e;
  return e;
}

/** Réservé aux tests. */
export function resetEnvCache() {
  cached = undefined;
}
