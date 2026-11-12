import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { ai, type AssetSummary } from "@/lib/ai";
import { planLimits } from "@/lib/billing/plans";
import { voiceEnvelope } from "@/lib/character/mouth";
import type { TalkingCharacter } from "@/lib/character/plan";
import { type CharacterGroup, groupCharacters } from "@/lib/character/poses";
import { prepareCharacter } from "@/lib/character/render";
import { db, schema } from "@/lib/db";
import type { Asset, BrandKit, Project } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { sceneSpans } from "@/lib/plan/align";
import { brandPalette, buildPlan, type BrandInput } from "@/lib/plan/build";
import type { Directions } from "@/lib/plan/directions";
import { type EditPlan, referencedAssetIds } from "@/lib/plan/schema";
import {
  analyzeAudio,
  analyzeFrames,
  checkAudio,
  checkFrames,
  checkSync,
  checkTechnical,
  extractSceneFrames,
  probe,
} from "@/lib/qc/post-render";
import {
  checkBrandKit,
  checkPlanValidity,
  checkRights,
  checkVoiceScenes,
  type QcAsset,
} from "@/lib/qc/pre-render";
import { checkPlatforms, checkReadability, contrastRatio } from "@/lib/qc/rules";
import { blocksPublication, type QcCheck, type QcReport } from "@/lib/qc/types";
import { buildAss } from "@/lib/render/ass";
import { buildFfmpegArgs, run } from "@/lib/render/ffmpeg";
import type { Script } from "@/lib/script/schema";
import { storage } from "@/lib/storage";
import { isRealStt, stt } from "@/lib/stt";
import type { MontageJob } from "@/lib/jobs";

export const MAX_ATTEMPTS = 3;
const DEFAULT_FONTS = ["Bricolage Grotesque", "IBM Plex Sans"];

async function setProgress(
  projectId: string,
  progress: number,
  message: string,
  status: Project["renderStatus"] = "running",
) {
  await db()
    .update(schema.projects)
    .set({ renderStatus: status, renderProgress: Math.round(progress), renderMessage: message })
    .where(eq(schema.projects.id, projectId));
}

/** Gain (dB) pour ramener le volume à -14 LUFS, ou 0 si l'écart est faible ou la mesure impossible. */
export function loudnessCorrection(lufs: number): number {
  if (!Number.isFinite(lufs) || lufs < -50) return 0;
  const delta = -14 - lufs;
  if (Math.abs(delta) <= 0.8) return 0;
  return Math.max(-20, Math.min(20, delta));
}

export function brandInput(kit: BrandKit | undefined): BrandInput {
  // La version « sur fond sombre » du logo sert quand le fond de la marque est sombre.
  const bg = brandPalette(kit?.colors ?? []).background;
  const darkBg = contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#000000");
  return {
    colors: kit?.colors ?? [],
    titleFont: kit?.titleFont ?? "Bricolage Grotesque",
    bodyFont: kit?.bodyFont ?? "IBM Plex Sans",
    subtitleStyle: kit?.subtitleStyle ?? "boxed",
    subtitlePosition: kit?.subtitlePosition ?? "bottom",
    logoAssetId:
      (darkBg ? (kit?.logoDarkAssetId ?? kit?.logoAssetId) : (kit?.logoAssetId ?? kit?.logoDarkAssetId)) ??
      null,
  };
}

/** Assets que l'IA peut utiliser : ceux du projet d'abord, puis la bibliothèque. */
export async function candidateAssets(project: Project, kit: BrandKit | undefined): Promise<Asset[]> {
  const linked = await db()
    .select({ assetId: schema.projectAssets.assetId })
    .from(schema.projectAssets)
    .where(eq(schema.projectAssets.projectId, project.id));
  const linkedIds = linked.map((l) => l.assetId);
  const extraIds = [kit?.logoAssetId, kit?.logoDarkAssetId].filter((x): x is string => !!x);
  const library = await db()
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.userId, project.userId),
        or(
          inArray(schema.assets.kind, ["video", "image", "character", "music"]),
          linkedIds.length || extraIds.length
            ? inArray(schema.assets.id, [...linkedIds, ...extraIds])
            : undefined,
        ),
      ),
    )
    .orderBy(desc(schema.assets.createdAt))
    .limit(60);
  return library.sort((a, b) => Number(linkedIds.includes(b.id)) - Number(linkedIds.includes(a.id)));
}

/**
 * Personnages fournis pour cette vidéo (liés au projet), avec toutes leurs images (poses).
 * Les poses sont ajoutées à `assets` pour être téléchargées au rendu.
 */
export async function projectCharacters(project: Project, assets: Asset[]): Promise<TalkingCharacter[]> {
  const linked = await db()
    .select({ assetId: schema.projectAssets.assetId })
    .from(schema.projectAssets)
    .where(eq(schema.projectAssets.projectId, project.id));
  if (!linked.length) return [];
  const all = await db()
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.userId, project.userId), eq(schema.assets.kind, "character")));
  const linkedIds = new Set(linked.map((l) => l.assetId));
  const groups = groupCharacters(all).filter((g) => g.ids.some((id) => linkedIds.has(id)));
  const known = new Set(assets.map((a) => a.id));
  for (const a of all) {
    if (groups.some((g) => g.ids.includes(a.id)) && !known.has(a.id)) assets.push(a);
  }
  // Un seul personnage parle pour l'instant : celui qui a le plus d'images (bouche animée).
  return groups
    .sort((a, b) => Number(b.canTalk) - Number(a.canTalk) || b.ids.length - a.ids.length)
    .slice(0, 1)
    .map((group) => {
      const main = all.find((a) => a.id === group.mainId);
      return { group, aspect: main?.width && main.height ? main.width / main.height : 0.75 };
    });
}

/**
 * Ce que l'IA voit des fichiers : une seule entrée par personnage (pas une par pose), et rien
 * pour le personnage qui parle, déjà incrusté. Moins de jetons, et pas de personnage en fond.
 */
export function aiVisibleAssets(assets: Asset[], speaking: TalkingCharacter[]): Asset[] {
  const hidden = new Set(speaking.flatMap((c) => c.group.ids));
  const groups: CharacterGroup[] = groupCharacters(assets);
  for (const g of groups) for (const id of g.ids) if (id !== g.mainId) hidden.add(id);
  return assets.filter((a) => !hidden.has(a.id));
}

const summary = (a: Asset): AssetSummary => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  description: a.description,
  durationSec: a.durationSec,
});

export type MontageDeps = { now?: () => Date };

/**
 * Le montage complet : transcription, choix de l'IA, plan de montage, contrôle avant rendu,
 * rendu FFmpeg, contrôle après rendu. Jusqu'à 3 tentatives de correction automatique.
 */
export async function runMontage(job: MontageJob): Promise<void> {
  const e = env();
  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, job.projectId));
  if (!project) return;
  try {
    await doMontage(project, job);
  } catch (err) {
    console.error("[montage]", project.id, err);
    await setProgress(
      project.id,
      0,
      err instanceof Error && e.NODE_ENV !== "production" ? err.message : "Le montage a échoué. Relance-le.",
      "failed",
    );
    throw err;
  }
}

export async function doMontage(project: Project, job: MontageJob) {
  const e = env();
  if (!project.script) throw new Error("Le script n'est pas encore écrit.");
  if (!project.selectedTakeId) throw new Error("Aucune prise de voix retenue.");
  const script: Script = project.script;
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, project.userId));
  if (!user) return;
  const [take] = await db().select().from(schema.takes).where(eq(schema.takes.id, project.selectedTakeId));
  if (!take) throw new Error("Prise de voix introuvable.");
  const [kit] = await db().select().from(schema.brandKits).where(eq(schema.brandKits.userId, project.userId));
  const brand = brandInput(kit);
  const limits = planLimits(user.plan);

  await mkdir(path.resolve(e.WORK_DIR), { recursive: true });
  const work = await mkdtemp(path.join(path.resolve(e.WORK_DIR), "montage-"));
  try {
    await setProgress(project.id, 3, "Transcription de ta voix");
    const voiceFile = path.join(work, `voice${path.extname(take.storageKey) || ".webm"}`);
    await storage().download(take.storageKey, voiceFile);
    let words = take.words;
    if (!words?.length) {
      words = await stt().transcribe({
        filePath: voiceFile,
        mime: take.mime,
        durationSec: take.durationSec,
        expectedText: script.scenes.map((s) => s.text).join(" "),
      });
      if (!words.length) throw new Error("Aucun mot reconnu dans ta prise. Vérifie ton micro.");
      await db().update(schema.takes).set({ words }).where(eq(schema.takes.id, take.id));
    }

    // Les prises WebM du navigateur peuvent changer de format audio en cours de route, ce qui fait
    // échouer le graphe de filtres du rendu (« Cannot select channel layout »). On les convertit
    // d'abord en WAV mono 48 kHz, au format fixe.
    const renderVoice = path.join(work, "voice-render.wav");
    await run(e.FFMPEG_PATH, [
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      voiceFile,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      renderVoice,
    ]);

    const assets = await candidateAssets(project, kit);
    const characters = await projectCharacters(project, assets);
    const aiAssets = aiVisibleAssets(assets, characters);
    // Volume de la voix image par image, pour faire bouger la bouche du personnage.
    const envelope = characters.some((c) => c.group.canTalk || c.group.poses.blink)
      ? voiceEnvelope(await readFile(renderVoice))
      : null;
    const spans = sceneSpans(script.scenes, words);
    const sceneDurations = spans.map((s, i) => {
      const next = spans[i + 1];
      const start = words[s.firstWord]?.start ?? 0;
      const end = next ? (words[next.firstWord]?.start ?? start) : (words[words.length - 1]?.end ?? start);
      return { sceneId: s.sceneId, durationSec: Math.max(0, end - start) };
    });

    await setProgress(project.id, 10, "L'IA choisit les plans");
    let directions: Directions = await ai().directMontage({
      script,
      sceneDurations,
      assets: aiAssets.map(summary),
      instruction: job.instruction,
      sceneId: job.sceneId,
      previous: project.directions ?? undefined,
    });

    const qcAssets: QcAsset[] = assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      rights: a.rights,
    }));
    let report: QcReport | null = null;
    let plan: EditPlan | null = null;
    let renderKey: string | null = null;
    let sizeBytes = 0;
    let durationSec = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const base = 15 + (attempt - 1) * 5;
      await setProgress(
        project.id,
        base,
        attempt === 1
          ? "Construction du plan de montage"
          : `Correction automatique (${attempt}/${MAX_ATTEMPTS})`,
      );
      plan = buildPlan({
        format: project.format,
        script,
        take: { id: take.id, durationSec: take.durationSec, words },
        directions,
        assets: assets.map((a) => ({ id: a.id, kind: a.kind, durationSec: a.durationSec })),
        brand,
        watermark: limits.watermark,
        characters,
        voiceEnvelope: envelope,
      });

      const pre: QcCheck[] = [
        ...checkPlanValidity(plan, {
          assets: qcAssets,
          targetDurationSec: project.targetDurationSec,
          maxDurationSec: limits.maxDurationSec,
        }),
        ...checkVoiceScenes(plan, script, words),
        ...checkBrandKit(plan, brand),
        ...checkRights(plan, qcAssets),
      ];
      // Une erreur avant rendu que l'IA ne peut pas corriger seule (droits, durée, scène non dite) :
      // on s'arrête et on la montre, sans dépenser un rendu.
      const preFails = pre.filter((c) => c.status === "fail");
      if (preFails.length) {
        report = {
          planVersion: project.planVersion + 1,
          checkedAt: new Date().toISOString(),
          attempts: attempt,
          checks: pre,
        };
        break;
      }

      await setProgress(project.id, base + 5, "Rendu de la vidéo");
      let out = path.join(work, `render-${attempt}.mp4`);
      await renderPlan(plan, {
        work,
        voiceFile: renderVoice,
        assets,
        out,
        onProgress: (p) => setProgress(project.id, base + 5 + p * 0.55, "Rendu de la vidéo"),
      });

      await setProgress(project.id, 85, "Contrôle qualité de la vidéo");
      let audio = await analyzeAudio(e.FFMPEG_PATH, out);
      // Le volume dépend de la voix : on corrige l'écart mesuré (gain fixe et limiteur), sans refaire l'image.
      const gain = loudnessCorrection(audio.integratedLufs);
      if (gain !== 0) {
        const fixed = path.join(work, `render-${attempt}-volume.mp4`);
        await run(e.FFMPEG_PATH, [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          out,
          "-map",
          "0:v",
          "-map",
          "0:a",
          "-c:v",
          "copy",
          "-af",
          `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=disabled`,
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          fixed,
        ]);
        out = fixed;
        audio = await analyzeAudio(e.FFMPEG_PATH, out);
      }
      const probed = await probe(e.FFPROBE_PATH, out);
      const frames = await analyzeFrames(e.FFMPEG_PATH, out);
      let renderedWords = null;
      if (isRealStt()) {
        renderedWords = await stt()
          .transcribe({ filePath: out, mime: "video/mp4", durationSec: probed.durationSec })
          .catch(() => null);
      }
      const review = await aiReview(plan, script, out, work);
      const post: QcCheck[] = [
        ...checkTechnical(plan, probed),
        ...checkFrames(plan, frames),
        ...checkAudio(plan, audio),
        ...checkSync(plan, renderedWords),
        ...checkReadability(plan),
        ...review,
        ...checkPlatforms(project.platforms, {
          durationSec: probed.durationSec,
          sizeBytes: probed.sizeBytes,
          format: plan.format,
        }),
      ];
      report = {
        planVersion: project.planVersion + 1,
        checkedAt: new Date().toISOString(),
        attempts: attempt,
        checks: [...pre, ...post],
      };
      renderKey = `u/${project.userId}/renders/${project.id}/v${project.planVersion + 1}.mp4`;
      sizeBytes = probed.sizeBytes;
      durationSec = probed.durationSec;
      await storage().put(renderKey, createReadStream(out), "video/mp4");
      const poster = path.join(work, "poster.jpg");
      await run(e.FFMPEG_PATH, [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        "0.5",
        "-i",
        out,
        "-frames:v",
        "1",
        "-vf",
        "scale=540:-2",
        "-q:v",
        "4",
        poster,
      ]);
      await storage().put(`${renderKey}.jpg`, await readFile(poster), "image/jpeg");

      const fails = post.filter((c) => c.status === "fail");
      if (!fails.length || attempt === MAX_ATTEMPTS) break;
      const fixed = await autoFix(fails, directions, { script, sceneDurations, assets: aiAssets });
      if (!fixed) break;
      directions = fixed;
    }

    await db()
      .update(schema.projects)
      .set({
        editPlan: plan,
        directions,
        planVersion: project.planVersion + 1,
        qcReport: report,
        acknowledgedWarnings: [],
        renderKey: renderKey ?? project.renderKey,
        renderSizeBytes: renderKey ? sizeBytes : project.renderSizeBytes,
        renderDurationSec: renderKey ? durationSec : project.renderDurationSec,
        renderStatus: renderKey ? "done" : "failed",
        renderProgress: renderKey ? 100 : 0,
        renderMessage: renderKey ? null : "Le contrôle qualité a trouvé un problème avant le rendu.",
        status:
          project.status === "published" || project.status === "scheduled"
            ? project.status
            : renderKey && !blocksPublication(report)
              ? "ready"
              : "montage",
      })
      .where(eq(schema.projects.id, project.id));
    // L'ancienne version de la vidéo n'est plus utile.
    if (renderKey && project.renderKey && project.renderKey !== renderKey) {
      await storage()
        .delete(project.renderKey)
        .catch(() => undefined);
      await storage()
        .delete(`${project.renderKey}.jpg`)
        .catch(() => undefined);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Corrections automatiques après un test rouge. Renvoie null si rien n'est corrigeable. */
async function autoFix(
  fails: QcCheck[],
  directions: Directions,
  ctx: { script: Script; sceneDurations: { sceneId: string; durationSec: number }[]; assets: Asset[] },
): Promise<Directions | null> {
  let next = structuredClone(directions);
  let changed = false;
  for (const f of fails) {
    const sceneId = f.sceneId?.split(".")[0];
    if (f.testId === "frames" && sceneId) {
      // Image noire ou cassée : on remplace le visuel de la scène par un fond de couleur.
      next = {
        ...next,
        scenes: next.scenes.map((s) => (s.sceneId === sceneId ? { ...s, assetIds: [] } : s)),
      };
      changed = true;
    } else if (f.testId === "ai-review" && sceneId) {
      next = await ai().directMontage({
        script: ctx.script,
        sceneDurations: ctx.sceneDurations,
        assets: ctx.assets.map(summary),
        instruction: `Corrige ce problème : ${f.title}. ${f.detail ?? ""}`,
        sceneId,
        previous: next,
      });
      changed = true;
    } else if (f.testId === "technical") {
      changed = true; // Un nouveau rendu suffit souvent.
    }
  }
  return changed ? next : null;
}

async function aiReview(plan: EditPlan, script: Script, file: string, work: string): Promise<QcCheck[]> {
  const e = env();
  const dir = path.join(work, "frames");
  await mkdir(dir, { recursive: true });
  const frames = await extractSceneFrames(e.FFMPEG_PATH, file, plan, dir);
  const issues = await ai()
    .reviewFrames({
      script,
      frames: await Promise.all(
        frames.map(async (f) => ({
          sceneId: f.sceneId,
          jpeg: await readFile(f.path),
          spokenText: plan.scenes.find((s) => s.id === f.sceneId)?.spokenText ?? "",
        })),
      ),
    })
    .catch((err) => {
      console.error("[ai-review]", err);
      return undefined;
    });
  if (issues === null) {
    return [
      {
        key: "ai-review:off",
        testId: "ai-review",
        status: "skipped",
        title: "Relecture par l'IA non configurée",
      },
    ];
  }
  if (issues === undefined) {
    return [
      {
        key: "ai-review:error",
        testId: "ai-review",
        status: "warn",
        title: "Relecture par l'IA indisponible",
        detail: "Regarde la vidéo avant de publier.",
      },
    ];
  }
  if (!issues.length) {
    return [
      {
        key: "ai-review:ok",
        testId: "ai-review",
        status: "pass",
        title: "Relecture par l'IA : rien à signaler",
      },
    ];
  }
  return issues.map((i, k) => ({
    key: `ai-review:${i.sceneId}:${k}`,
    testId: "ai-review" as const,
    status: i.severity,
    title: i.title,
    detail: i.detail,
    sceneId: plan.scenes.some((s) => s.id === i.sceneId) ? i.sceneId : undefined,
  }));
}

/** Télécharge les fichiers du plan, écrit les sous-titres et lance FFmpeg. */
export async function renderPlan(
  plan: EditPlan,
  opts: {
    work: string;
    voiceFile: string | null;
    assets: Asset[];
    out: string;
    onProgress?: (pct: number) => void;
    scale?: number;
  },
) {
  const e = env();
  const byId = new Map(opts.assets.map((a) => [a.id, a]));
  const media = new Map<string, { path: string; kind: string }>();
  for (const id of referencedAssetIds(plan)) {
    const a = byId.get(id);
    if (!a) throw new Error(`Fichier introuvable : ${id}`);
    const key = a.renderKey ?? a.storageKey;
    const file = path.join(opts.work, "assets", `${a.id}${path.extname(key)}`);
    await stat(file).catch(() => storage().download(key, file));
    media.set(id, { path: file, kind: a.kind });
  }
  // Polices : celles de l'app plus celles importées par l'utilisateur.
  const fontsDir = path.join(opts.work, "fonts");
  await mkdir(fontsDir, { recursive: true });
  for (const f of await readdir(path.resolve(e.FONTS_DIR))) {
    if (/\.(ttf|otf)$/i.test(f))
      await copyFile(path.join(path.resolve(e.FONTS_DIR), f), path.join(fontsDir, f));
  }
  const wanted = new Set(
    [plan.brand.titleFont, plan.brand.bodyFont, plan.subtitles.font].filter(
      (f) => !DEFAULT_FONTS.includes(f),
    ),
  );
  if (wanted.size) {
    const userId = opts.assets[0]?.userId;
    const fonts = userId
      ? await db()
          .select()
          .from(schema.assets)
          .where(and(eq(schema.assets.userId, userId), eq(schema.assets.kind, "font")))
      : [];
    for (const f of fonts) {
      if (f.fontFamily && wanted.has(f.fontFamily)) {
        await storage().download(f.storageKey, path.join(fontsDir, `${f.id}${path.extname(f.name)}`));
      }
    }
  }
  // Personnages animés : images mises à la bonne taille et enchaînement des poses.
  const characters = new Map<string, string>();
  const files = new Map([...media].map(([id, m]) => [id, m.path]));
  for (const [id, rig] of Object.entries(plan.characterRigs ?? {})) {
    characters.set(
      id,
      await prepareCharacter(rig, files, path.join(opts.work, `character-${id}`), opts.scale),
    );
  }
  const assPath = path.join(opts.work, "subtitles.ass");
  await writeFile(assPath, buildAss(plan, { watermarkText: `Fait avec ${e.APP_NAME}` }));
  const args = buildFfmpegArgs(
    plan,
    { assets: media, voicePath: opts.voiceFile, assPath, fontsDir, characters },
    opts.out,
    {
      preset: "veryfast",
      crf: 21,
      scale: opts.scale,
    },
  );
  let last = 0;
  await run(e.FFMPEG_PATH, args, {
    timeoutMs: 30 * 60 * 1000,
    onProgress: (sec) => {
      const pct = Math.min(100, (sec / plan.durationSec) * 100);
      if (pct - last >= 5) {
        last = pct;
        void opts.onProgress?.(pct);
      }
    },
  });
}
