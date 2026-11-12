import { env } from "@/lib/env";

export type PlanId = "free" | "creator";

export function planLimits(plan: PlanId) {
  const e = env();
  return plan === "creator"
    ? {
        videosPerMonth: e.CREATOR_VIDEOS_PER_MONTH,
        maxDurationSec: e.CREATOR_MAX_DURATION_SEC,
        watermark: false,
        scheduling: true,
      }
    : {
        videosPerMonth: e.FREE_VIDEOS_PER_MONTH,
        maxDurationSec: e.FREE_MAX_DURATION_SEC,
        watermark: e.FREE_WATERMARK,
        scheduling: false,
      };
}

export const PLAN_LABELS: Record<PlanId, string> = { free: "Gratuit", creator: "Créateur" };
