import { env } from "@/lib/env";

/** Prix de l'offre Créateur, à définir (variable CREATOR_PRICE_EUR). */
export function creatorPrice(): string {
  const p = process.env.CREATOR_PRICE_EUR;
  return p ? p.replace(".", ",") : "[PRIX]";
}

export function offerFacts() {
  const e = env();
  return {
    freeVideos: e.FREE_VIDEOS_PER_MONTH,
    creatorVideos: e.CREATOR_VIDEOS_PER_MONTH,
    freeMaxSec: e.FREE_MAX_DURATION_SEC,
    creatorMaxSec: e.CREATOR_MAX_DURATION_SEC,
    freeWatermark: e.FREE_WATERMARK,
  };
}
