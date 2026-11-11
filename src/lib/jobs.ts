import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const QUEUES = {
  analyzeAsset: "analyze-asset",
  montage: "montage",
  publish: "publish",
} as const;

export type MontageJob = { projectId: string; instruction?: string; sceneId?: string };
export type AnalyzeAssetJob = { assetId: string };
export type PublishJob = { publicationId: string };

const globalForBoss = globalThis as unknown as { __boss?: Promise<PgBoss> };

export function boss(): Promise<PgBoss> {
  if (!globalForBoss.__boss) {
    globalForBoss.__boss = (async () => {
      const b = new PgBoss({ connectionString: env().DATABASE_URL, max: 4 });
      b.on("error", (err) => console.error("[jobs]", err));
      await b.start();
      await b.createQueue(QUEUES.analyzeAsset, { retryLimit: 2, retryDelay: 10, expireInSeconds: 600 });
      await b.createQueue(QUEUES.montage, { retryLimit: 1, retryDelay: 30, expireInSeconds: 3600 });
      await b.createQueue(QUEUES.publish, { retryLimit: 3, retryDelay: 60, expireInSeconds: 600 });
      return b;
    })();
  }
  return globalForBoss.__boss;
}

export async function enqueue<T extends object>(
  queue: string,
  data: T,
  options: { startAfter?: Date; singletonKey?: string } = {},
) {
  const b = await boss();
  return b.send(queue, data, options);
}

export async function stopBoss() {
  if (globalForBoss.__boss) {
    const b = await globalForBoss.__boss;
    await b.stop({ graceful: true, timeout: 30_000 });
    globalForBoss.__boss = undefined;
  }
}
