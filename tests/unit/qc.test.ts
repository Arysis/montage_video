import { describe, expect, it } from "vitest";
import {
  checkAudio,
  checkFrames,
  checkSync,
  checkTechnical,
  parseAudioAnalysis,
  parseFrameAnalysis,
} from "@/lib/qc/post-render";
import {
  checkBrandKit,
  checkPlanValidity,
  checkRights,
  checkVoiceScenes,
  type QcAsset,
} from "@/lib/qc/pre-render";
import { checkPlatforms, checkReadability, contrastRatio } from "@/lib/qc/rules";
import { blocksPublication, pendingWarnings, QC_TESTS, worstStatus, type QcCheck } from "@/lib/qc/types";
import { brand, IDS, samplePlan, script, wordsFor } from "../helpers/fixtures";

const qcAssets: QcAsset[] = [
  { id: IDS["img-1"], kind: "image", name: "photo.png", rights: "own" },
  { id: IDS["vid-1"], kind: "video", name: "plan.mp4", rights: "licensed" },
  { id: IDS["logo-1"], kind: "logo", name: "logo.svg", rights: "own" },
  { id: IDS["music-1"], kind: "music", name: "musique.mp3", rights: "free" },
];
const ctx = { assets: qcAssets, targetDurationSec: 15, maxDurationSec: 60 };
const words = wordsFor(script.scenes.map((s) => s.text).join(" "));
const status = (checks: QcCheck[], key: string) => checks.find((c) => c.key === key)?.status;

describe("les 11 tests", () => {
  it("couvrent les trois moments du contrôle", () => {
    expect(QC_TESTS).toHaveLength(11);
    expect(new Set(QC_TESTS.map((t) => t.stage))).toEqual(
      new Set(["pre-render", "post-render", "pre-publish"]),
    );
  });
});

describe("avant le rendu", () => {
  it("valide un plan correct", () => {
    expect(worstStatus(checkPlanValidity(samplePlan(), ctx))).not.toBe("fail");
  });

  it("refuse un plan mal formé", () => {
    const checks = checkPlanValidity({ version: 1, scenes: [] }, ctx);
    expect(checks[0]!.status).toBe("fail");
    expect(checks[0]!.key).toBe("plan-validity:schema");
  });

  it("refuse un fichier cité qui n'existe pas", () => {
    const checks = checkPlanValidity(samplePlan(), {
      ...ctx,
      assets: qcAssets.filter((a) => a.kind !== "image"),
    });
    expect(worstStatus(checks)).toBe("fail");
  });

  it("repère une scène du script absente de la voix", () => {
    const spoken = [script.scenes[0]!.text, script.scenes[2]!.text, script.scenes[3]!.text].join(" ");
    const checks = checkVoiceScenes(samplePlan(), script, wordsFor(spoken));
    expect(checks.some((c) => c.status === "fail" && c.title.includes("Scène 2"))).toBe(true);
  });

  it("signale un plan trop long", () => {
    const plan = samplePlan();
    plan.scenes = [{ ...plan.scenes[0]!, start: 0, end: plan.durationSec }];
    const checks = checkVoiceScenes(plan, script, words);
    const long = checks.find((c) => c.title.includes("trop long"));
    expect(long?.status).toBe("warn");
    expect(long?.detail).toMatch(/Vise moins de 4 s/);
    expect(long?.sceneId).toBeDefined();
  });

  it("vérifie les couleurs, les polices et le logo du Brand Kit", () => {
    const ok = checkBrandKit(samplePlan(), brand);
    expect(ok.every((c) => c.status === "pass")).toBe(true);
    const plan = samplePlan();
    plan.subtitles.font = "Comic Sans";
    plan.logo = null;
    const bad = checkBrandKit(plan, brand);
    expect(status(bad, "brand-kit:fonts")).toBe("fail");
    expect(status(bad, "brand-kit:logo")).toBe("warn");
  });

  it("bloque un fichier aux droits inconnus", () => {
    const plan = samplePlan();
    expect(checkRights(plan, qcAssets)[0]!.status).toBe("pass");
    const unknown = qcAssets.map((a) => (a.kind === "image" ? { ...a, rights: "unknown" as const } : a));
    const res = checkRights(plan, unknown);
    expect(res[0]!.status).toBe("fail");
    expect(res[0]!.title).toContain("photo.png");
  });
});

describe("lisibilité et plateformes", () => {
  it("calcule le contraste WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#F2EFE9", "#0E0F11")).toBeGreaterThan(4.5);
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(1.5);
  });

  it("refuse des sous-titres illisibles", () => {
    const plan = samplePlan();
    plan.subtitles.color = "#222222";
    plan.subtitles.boxColor = "#111111";
    expect(status(checkReadability(plan), "readability:contrast")).not.toBe("pass");
  });

  it("valide un plan lisible", () => {
    const checks = checkReadability(samplePlan());
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
  });

  it("vérifie les règles de chaque plateforme", () => {
    const ok = checkPlatforms(["tiktok", "instagram"], { durationSec: 30, sizeBytes: 20e6, format: "9:16" });
    expect(ok.every((c) => c.status === "pass")).toBe(true);
    const tooShort = checkPlatforms(["tiktok"], { durationSec: 2, sizeBytes: 1e6, format: "9:16" });
    expect(tooShort[0]!.status).toBe("fail");
    const shortsTooLong = checkPlatforms(["youtube"], { durationSec: 200, sizeBytes: 1e6, format: "9:16" });
    expect(shortsTooLong[0]!.status).toBe("fail");
    const reelsHorizontal = checkPlatforms(["instagram"], {
      durationSec: 30,
      sizeBytes: 1e6,
      format: "16:9",
    });
    expect(reelsHorizontal[0]!.status).toBe("fail");
  });
});

describe("après le rendu", () => {
  const plan = samplePlan();
  const goodProbe = {
    durationSec: plan.durationSec,
    sizeBytes: 5e6,
    video: {
      codec: "h264",
      width: 1080,
      height: 1920,
      rFrameRate: "30/1",
      avgFrameRate: "30/1",
      frames: Math.round(plan.durationSec * 30),
    },
    audio: { codec: "aac", sampleRate: 48000, channels: 2 },
  };

  it("valide un fichier conforme", () => {
    expect(checkTechnical(plan, goodProbe)[0]!.status).toBe("pass");
  });

  it("refuse une mauvaise résolution ou une piste manquante", () => {
    const res = checkTechnical(plan, {
      ...goodProbe,
      video: { ...goodProbe.video, width: 720 },
      audio: undefined,
    });
    expect(res[0]!.status).toBe("fail");
    expect(res[0]!.detail).toMatch(/pas de piste audio/);
  });

  it("lit les écrans noirs, les images figées et les flashs", () => {
    const stderr =
      "[blackdetect @ 0x1] black_start:2.0 black_end:3.5 black_duration:1.5\n[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 4.0\nlavfi.freezedetect.freeze_end: 7.0";
    const meta =
      "frame:0 pts_time:0.0\nlavfi.signalstats.YAVG=20\nframe:1 pts_time:0.033\nlavfi.signalstats.YAVG=200\n";
    const a = parseFrameAnalysis(stderr, meta);
    expect(a.black).toEqual([{ start: 2, end: 3.5 }]);
    expect(a.freeze).toEqual([{ start: 4, end: 7 }]);
    expect(a.flashes).toEqual([0.033]);
    expect(worstStatus(checkFrames(plan, a))).not.toBe("pass");
    expect(worstStatus(checkFrames(plan, { black: [], freeze: [], flashes: [] }))).toBe("pass");
  });

  it("lit le volume, la crête et les silences", () => {
    const stderr =
      "silence_start: 3.2\nsilence_end: 7.0 | silence_duration: 3.8\nSummary:\n  Integrated loudness:\n    I:         -14.3 LUFS\n  True peak:\n    Peak:       -1.2 dBFS";
    const a = parseAudioAnalysis(stderr);
    expect(a.integratedLufs).toBe(-14.3);
    expect(a.truePeakDb).toBe(-1.2);
    expect(a.silences).toEqual([{ start: 3.2, end: 7 }]);
    const checks = checkAudio(plan, a);
    expect(status(checks, "audio:loudness")).toBe("pass");
    expect(status(checks, "audio:silence")).toBe("fail");
    expect(status(checks, "audio:music")).toBe("pass");
  });

  it("mesure le décalage des sous-titres avec une nouvelle transcription", () => {
    expect(checkSync(plan, null)[0]!.status).toBe("pass");
    const heard = plan.subtitles.words.map((w) => ({ ...w, start: w.start + 0.05 }));
    expect(checkSync(plan, heard)[0]!.status).toBe("pass");
    const late = plan.subtitles.words.map((w) => ({ ...w, start: w.start + 0.8 }));
    expect(checkSync(plan, late)[0]!.status).toBe("fail");
  });
});

describe("décision de publication", () => {
  const report = (checks: QcCheck[]) => ({ planVersion: 1, checkedAt: "", attempts: 1, checks });
  it("bloque sur un test rouge, demande une validation sur un orange", () => {
    const warn: QcCheck = { key: "w", testId: "voice-scenes", status: "warn", title: "Plan 3 trop long" };
    const fail: QcCheck = { key: "f", testId: "rights", status: "fail", title: "Droits inconnus" };
    expect(blocksPublication(null)).toBe(true);
    expect(blocksPublication(report([warn]))).toBe(false);
    expect(blocksPublication(report([warn, fail]))).toBe(true);
    expect(pendingWarnings(report([warn]), [])).toHaveLength(1);
    expect(pendingWarnings(report([warn]), ["w"])).toHaveLength(0);
  });
});
