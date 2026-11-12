import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ai } from "@/lib/ai";
import { analyzeAsset } from "@/lib/assets";
import { characterNameFrom, detectPose } from "@/lib/character/poses";
import { closeDb, db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { mediaDuration } from "@/lib/media";
import { doMontage } from "@/lib/pipeline/montage";
import { probe } from "@/lib/qc/post-render";
import { storage } from "@/lib/storage";
import { makeVoice, setupIntegration } from "./setup";

let root = "";
let projectId = "";
const ids: Record<string, string> = {};

/** Un personnage simple (rond orange) dont la bouche a la hauteur demandée, fond transparent. */
async function face(file: string, mouth: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><circle cx="300" cy="400" r="280" fill="#FF8C1A"/><ellipse cx="300" cy="520" rx="90" ry="${mouth}" fill="#000"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

beforeAll(async () => {
  root = await setupIntegration();
  const [user] = await db()
    .insert(schema.users)
    .values({ email: "personnage@example.com", passwordHash: "x" })
    .returning();
  const userId = user!.id;

  for (const [name, mouth] of [
    ["renard-bouche-fermee.png", 4],
    ["renard-bouche-ouverte.png", 70],
    ["renard-mi-ouverte.png", 30],
  ] as const) {
    const file = path.join(root, name);
    await face(file, mouth);
    const key = `u/${userId}/assets/${name}`;
    const size = await storage().put(key, await readFile(file), "image/png");
    const [a] = await db()
      .insert(schema.assets)
      .values({
        userId,
        kind: "character",
        name,
        mime: "image/png",
        sizeBytes: size,
        storageKey: key,
        rights: "own",
        characterName: characterNameFrom(name),
        pose: detectPose(name),
      })
      .returning();
    await analyzeAsset(a!.id);
    ids[detectPose(name)] = a!.id;
  }

  const script = await ai().generateScript({
    idea: "Le renard explique trois astuces",
    format: "9:16",
    platforms: ["tiktok"],
    targetDurationSec: 15,
    assets: [],
  });
  const [project] = await db()
    .insert(schema.projects)
    .values({
      userId,
      name: script.title,
      idea: "Le renard explique trois astuces",
      format: "9:16",
      platforms: ["tiktok"],
      targetDurationSec: 15,
      script,
      status: "montage",
      countedAt: new Date(),
    })
    .returning();
  projectId = project!.id;
  // L'utilisateur n'a lié qu'une image du personnage : les autres viennent avec.
  await db().insert(schema.projectAssets).values({ projectId, assetId: ids.closed! });

  const voice = makeVoice(path.join(root, "voix"), 10);
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

describe("personnage qui parle", () => {
  it("incruste le personnage et fait bouger sa bouche sur la voix", async () => {
    const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    await doMontage(project!, { projectId });
    const [done] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
    expect(done!.renderStatus).toBe("done");

    const plan = done!.editPlan!;
    const rig = plan.characterRigs?.[ids.closed!];
    expect(rig).toBeDefined();
    expect(rig!.poses).toMatchObject({ closed: ids.closed, open: ids.open, half: ids.half });
    expect(rig!.mouth).toMatch(/o/);
    expect(rig!.mouth).toMatch(/c/);
    expect(plan.scenes.every((s) => s.character?.assetId === ids.closed)).toBe(true);
    // Le personnage n'est jamais utilisé comme fond.
    expect(
      plan.scenes.some((s) => s.visual.type === "asset" && Object.values(ids).includes(s.visual.assetId)),
    ).toBe(false);
    const fails = done!.qcReport!.checks.filter((c) => c.status === "fail");
    expect(fails).toEqual([]);

    // Dans la vidéo, la zone de la bouche change bien entre une image « fermée » et une image « ouverte ».
    const local = path.join(root, "perso.mp4");
    await storage().download(done!.renderKey!, local);
    const p = await probe(env().FFPROBE_PATH, local);
    expect(p.video?.width).toBe(1080);
    const at = (letter: string) => rig!.mouth.indexOf(letter) / 30 + 0.02;
    const grab = (t: number) => {
      const out = path.join(root, `frame-${t}.png`);
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        t.toFixed(3),
        "-i",
        local,
        "-frames:v",
        "1",
        out,
      ]);
      return out;
    };
    // Centre de la bouche dans l'image (boîte du personnage, bouche à 65 % de sa hauteur).
    const b = rig!.box;
    const region = {
      left: b.x + Math.round(b.w / 2) - 20,
      top: b.y + Math.round(b.h * 0.67),
      width: 40,
      height: 30,
    };
    const darkness = async (file: string) => {
      const { data } = await sharp(file)
        .extract(region)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data.reduce((n, v) => n + (v < 60 ? 1 : 0), 0) / data.length;
    };
    const closed = await darkness(grab(at("c")));
    const open = await darkness(grab(at("o")));
    expect(open).toBeGreaterThan(closed + 0.3);
  }, 240_000);
});
