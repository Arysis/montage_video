import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ai } from "@/lib/ai";
import { analyzeAsset } from "@/lib/assets";
import { closeDb, db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { mediaDuration } from "@/lib/media";
import { doMontage } from "@/lib/pipeline/montage";
import { runPublish } from "@/lib/pipeline/publish";
import { probe } from "@/lib/qc/post-render";
import { blocksPublication } from "@/lib/qc/types";
import { storage } from "@/lib/storage";
import { makeImage, makeVoice, setupIntegration } from "./setup";

let root = "";
let userId = "";
let projectId = "";

beforeAll(async () => {
  root = await setupIntegration();
  const [user] = await db()
    .insert(schema.users)
    .values({ email: "pipeline@example.com", passwordHash: "x", publishProfileKey: "mock-profile" })
    .returning();
  userId = user!.id;

  // Bibliothèque : un logo et deux images, analysés comme après un import.
  const files = [
    { kind: "logo" as const, file: makeImage(root, "0xff5a36"), name: "logo.png" },
    { kind: "image" as const, file: makeImage(root, "0x3355aa"), name: "photo-produit.png" },
    { kind: "image" as const, file: makeImage(root, "0x2e8b57"), name: "bureau.png" },
  ];
  const ids: string[] = [];
  for (const f of files) {
    const key = `u/${userId}/assets/${f.name}`;
    const size = await storage().put(key, await readFile(f.file), "image/png");
    const [a] = await db()
      .insert(schema.assets)
      .values({
        userId,
        kind: f.kind,
        name: f.name,
        mime: "image/png",
        sizeBytes: size,
        storageKey: key,
        rights: "own",
      })
      .returning();
    await analyzeAsset(a!.id);
    ids.push(a!.id);
  }
  await db()
    .insert(schema.brandKits)
    .values({
      userId,
      logoAssetId: ids[0]!,
      colors: [
        { name: "Principale", hex: "#FF5A36" },
        { name: "Fond", hex: "#0E0F11" },
        { name: "Texte", hex: "#F2EFE9" },
      ],
    });

  const script = await ai().generateScript({
    idea: "Trois erreurs à éviter sur TikTok",
    format: "9:16",
    platforms: ["tiktok", "instagram"],
    targetDurationSec: 15,
    assets: [],
  });
  const [project] = await db()
    .insert(schema.projects)
    .values({
      userId,
      name: script.title,
      idea: "Trois erreurs à éviter sur TikTok",
      format: "9:16",
      platforms: ["tiktok", "instagram"],
      targetDurationSec: 15,
      script,
      status: "montage",
      countedAt: new Date(),
    })
    .returning();
  projectId = project!.id;
  await db()
    .insert(schema.projectAssets)
    .values(ids.slice(1).map((assetId) => ({ projectId, assetId })));

  const voice = makeVoice(root, 14);
  const takeKey = `u/${userId}/takes/${projectId}/prise-1.webm`;
  await storage().put(takeKey, await readFile(voice), "audio/webm");
  const [take] = await db()
    .insert(schema.takes)
    .values({
      projectId,
      number: 1,
      storageKey: takeKey,
      mime: "audio/webm",
      durationSec: await mediaDuration(voice),
      complete: true,
    })
    .returning();
  await db()
    .update(schema.projects)
    .set({ selectedTakeId: take!.id })
    .where(eq(schema.projects.id, projectId));
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("montage complet", () => {
  it("monte, rend et contrôle la vidéo", async () => {
    const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    await doMontage(project!, { projectId });
    const [done] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));

    expect(done!.renderStatus).toBe("done");
    expect(done!.status).toBe("ready");
    expect(done!.editPlan?.scenes.length).toBeGreaterThan(3);
    expect(done!.editPlan?.logo).not.toBeNull();
    const report = done!.qcReport!;
    const fails = report.checks.filter((c) => c.status === "fail");
    expect(fails).toEqual([]);
    expect(blocksPublication(report)).toBe(false);
    // Les 11 tests sont présents (la relecture IA est « non vérifiée » avec le fournisseur simulé).
    const tests = new Set(report.checks.map((c) => c.testId));
    for (const t of [
      "plan-validity",
      "voice-scenes",
      "brand-kit",
      "rights",
      "technical",
      "frames",
      "audio",
      "sync",
      "readability",
      "ai-review",
      "platform",
    ]) {
      expect(tests.has(t as never)).toBe(true);
    }

    const local = path.join(root, "out.mp4");
    await storage().download(done!.renderKey!, local);
    const p = await probe(env().FFPROBE_PATH, local);
    expect(p.video?.codec).toBe("h264");
    expect(p.video?.width).toBe(1080);
    expect(p.video?.height).toBe(1920);
    expect(p.audio?.codec).toBe("aac");
    expect(Math.abs(p.durationSec - done!.editPlan!.durationSec)).toBeLessThan(0.15);
    expect(await storage().size(`${done!.renderKey}.jpg`)).toBeGreaterThan(1000);
  }, 240_000);

  it("refait une seule partie sur demande", async () => {
    const [before] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    await doMontage(before!, { projectId, sceneId: "s2", instruction: "Autre plan" });
    const [after] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    expect(after!.planVersion).toBeGreaterThan(before!.planVersion);
    expect(after!.renderKey).not.toBe(before!.renderKey);
    await expect(storage().size(before!.renderKey!)).rejects.toThrow();
  }, 240_000);

  it("publie la vidéo validée", async () => {
    const [pub] = await db()
      .insert(schema.publications)
      .values({ projectId, userId, platforms: ["tiktok"], caption: "Légende", scheduledAt: new Date() })
      .returning();
    await runPublish(pub!.id);
    const [res] = await db().select().from(schema.publications).where(eq(schema.publications.id, pub!.id));
    expect(res!.status).toBe("published");
    expect(res!.externalIds?.tiktok).toBeTruthy();
  });

  it("refuse de publier quand le contrôle qualité a un point rouge", async () => {
    const [p] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    await db()
      .update(schema.projects)
      .set({
        qcReport: {
          ...p!.qcReport!,
          checks: [
            ...p!.qcReport!.checks,
            { key: "x", testId: "rights", status: "fail", title: "Droits inconnus" },
          ],
        },
      })
      .where(eq(schema.projects.id, projectId));
    const [pub] = await db()
      .insert(schema.publications)
      .values({ projectId, userId, platforms: ["tiktok"], caption: "Légende", scheduledAt: new Date() })
      .returning();
    await runPublish(pub!.id);
    const [res] = await db().select().from(schema.publications).where(eq(schema.publications.id, pub!.id));
    expect(res!.status).toBe("failed");
  });

  it("efface tous les fichiers d'un compte", async () => {
    await storage().deletePrefix(`u/${userId}/`);
    const [p] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    await expect(storage().size(p!.renderKey!)).rejects.toThrow();
  });
});
