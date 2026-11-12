import { afterEach, describe, expect, it } from "vitest";
import { classifyUpload, formatBytes, sniffMatches } from "@/lib/assets";
import { resetEnvCache } from "@/lib/env";
import { loudnessCorrection } from "@/lib/pipeline/montage";
import { directionsFromScript } from "@/lib/plan/directions";
import {
  estimateSpeechSeconds,
  normalizeScript,
  sanitizeScript,
  scriptFromEditorText,
  scriptToLines,
} from "@/lib/script/schema";
import { signKey, verifySignedKey } from "@/lib/storage";
import { parisInputValues, parisToUtc } from "@/lib/time";
import { script } from "../helpers/fixtures";

describe("import de fichiers", () => {
  it("déduit le type depuis l'extension, pas depuis le navigateur", () => {
    expect(classifyUpload("logo-marque.png")).toEqual({ mime: "image/png", kind: "logo" });
    expect(classifyUpload("mascotte.webp")).toEqual({ mime: "image/webp", kind: "character" });
    expect(classifyUpload("plan.MOV")).toEqual({ mime: "video/quicktime", kind: "video" });
    expect(classifyUpload("intro.mp3")).toEqual({ mime: "audio/mpeg", kind: "music" });
    expect(classifyUpload("titre.otf")).toEqual({ mime: "font/otf", kind: "font" });
    expect(classifyUpload("virus.exe")).toBeNull();
    expect(classifyUpload("page.html")).toBeNull();
  });

  it("refuse un contenu déguisé", () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d", "hex");
    expect(sniffMatches("image/png", png)).toBe(true);
    expect(sniffMatches("image/jpeg", png)).toBe(false);
    expect(sniffMatches("image/png", Buffer.from("<html><script>"))).toBe(false);
    expect(sniffMatches("image/svg+xml", Buffer.from('<?xml version="1.0"?><svg>'))).toBe(true);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom")]);
    expect(sniffMatches("video/mp4", mp4)).toBe(true);
  });

  it("affiche les tailles en français", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536 * 1024)).toBe("1,5 Mo");
  });
});

describe("liens de fichiers signés", () => {
  afterEach(() => resetEnvCache());
  it("acceptent la bonne signature et refusent le reste", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signKey("u/1/renders/a.mp4", exp);
    expect(verifySignedKey("u/1/renders/a.mp4", exp, sig)).toBe(true);
    expect(verifySignedKey("u/2/renders/a.mp4", exp, sig)).toBe(false);
    expect(verifySignedKey("u/1/renders/a.mp4", exp + 1, sig)).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 1;
    expect(verifySignedKey("u/1/renders/a.mp4", past, signKey("u/1/renders/a.mp4", past))).toBe(false);
  });
});

describe("script et prompteur", () => {
  it("découpe le script en phrases", () => {
    const lines = scriptToLines(script);
    expect(lines.length).toBe(4);
    expect(lines[0]!.sceneId).toBe("s1");
  });

  it("reconstruit les scènes depuis l'éditeur", () => {
    const edited = scriptFromEditorText(script, "Première partie.\n\nDeuxième partie.\n\n\nTroisième.");
    expect(edited.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(edited.scenes[0]!.onScreenText).toBe("3 erreurs");
    expect(scriptFromEditorText(script, "   ").scenes).toEqual(script.scenes);
  });

  it("complète un ancien script avec les réglages de montage par défaut", () => {
    const old = normalizeScript({
      title: "Ancien",
      scenes: [{ id: "s1", text: "Bonjour.", visualIntent: "plan", onScreenText: null }],
      caption: "",
      hashtags: [],
    });
    expect(old.scenes[0]).toMatchObject({
      visuals: [],
      background: "aurore",
      transition: "cut",
      character: null,
    });
    expect(old.subtitles.enabled).toBe(true);
    expect(old.validatedAt).toBeNull();
  });

  it("écarte les fichiers inconnus et renumérote les scènes", () => {
    const clean = sanitizeScript(
      {
        ...script,
        musicAssetId: "inconnu",
        scenes: script.scenes.map((s, i) => ({
          ...s,
          id: `x${i}`,
          visuals: ["a", "inconnu", "a"],
          character: { assetId: "inconnu", talking: true },
        })),
      },
      new Set(["a"]),
    );
    expect(clean.musicAssetId).toBeNull();
    expect(clean.scenes[0]!.visuals).toEqual(["a"]);
    expect(clean.scenes[0]!.character).toBeNull();
    expect(clean.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("garde les choix de montage quand on retouche le texte", () => {
    const edited = scriptFromEditorText(
      { ...script, scenes: script.scenes.map((s) => ({ ...s, background: "nuit" as const })) },
      "Un.\n\nDeux.",
    );
    expect(edited.scenes[1]!.background).toBe("nuit");
  });

  it("donne au montage les choix du script", () => {
    const d = directionsFromScript(script);
    expect(d.scenes.map((s) => s.sceneId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(d.scenes[0]!.overlayText).toBe("3 erreurs");
    expect(d.subtitles).toBe(true);
  });

  it("estime la durée de lecture", () => {
    expect(
      estimateSpeechSeconds("un deux trois quatre cinq six sept huit neuf dix onze douze treize"),
    ).toBeCloseTo(5, 0);
  });
});

describe("volume", () => {
  it("corrige seulement les écarts sensibles", () => {
    expect(loudnessCorrection(-14.5)).toBe(0);
    expect(loudnessCorrection(-19)).toBeCloseTo(5);
    expect(loudnessCorrection(-8)).toBeCloseTo(-6);
    expect(loudnessCorrection(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(loudnessCorrection(-70)).toBe(0);
  });
});

describe("heure de Paris", () => {
  it("convertit en UTC en tenant compte de l'heure d'été", () => {
    expect(parisToUtc("2026-07-14", "12:00")!.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(parisToUtc("2026-12-25", "09:30")!.toISOString()).toBe("2026-12-25T08:30:00.000Z");
    expect(parisToUtc("2026-13-01", "09:30")).toBeNull();
    expect(parisToUtc("demain", "9h")).toBeNull();
    expect(parisInputValues(new Date("2026-01-10T23:30:00Z"))).toEqual({ date: "2026-01-11", time: "00:30" });
  });
});
