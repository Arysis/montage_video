import { analyzeAsset } from "@/lib/assets";
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { env } from "@/lib/env";
import { type AnalyzeAssetJob, boss, type MontageJob, type PublishJob, QUEUES, stopBoss } from "@/lib/jobs";
import { runMontage } from "@/lib/pipeline/montage";
import { runPublish } from "@/lib/pipeline/publish";

/**
 * Worker : exécute les tâches longues (analyse des fichiers, montage et rendu, publication).
 * Plusieurs workers peuvent tourner en parallèle, la file est dans Postgres.
 */
async function main() {
  env();
  if (process.env.RUN_MIGRATIONS === "1") await runMigrations();
  const b = await boss();
  const renderConcurrency = Number(process.env.RENDER_CONCURRENCY ?? 1);

  await b.work<AnalyzeAssetJob>(QUEUES.analyzeAsset, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) await analyzeAsset(job.data.assetId);
  });
  await b.work<MontageJob>(QUEUES.montage, { localConcurrency: renderConcurrency }, async (jobs) => {
    for (const job of jobs) await runMontage(job.data);
  });
  await b.work<PublishJob>(QUEUES.publish, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) await runPublish(job.data.publicationId);
  });
  console.info("[worker] prêt");

  const shutdown = async (signal: string) => {
    console.info(`[worker] arrêt (${signal})`);
    await stopBoss();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
