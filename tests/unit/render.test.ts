import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAss, escapeAss } from "@/lib/render/ass";
import { buildFfmpegArgs } from "@/lib/render/ffmpeg";
import { IDS, samplePlan } from "../helpers/fixtures";

const media = {
  assets: new Map([
    [IDS["img-1"], { path: "/tmp/img.png", kind: "image" }],
    [IDS["vid-1"], { path: "/tmp/vid.mp4", kind: "video" }],
    [IDS["logo-1"], { path: "/tmp/logo.png", kind: "logo" }],
    [IDS["music-1"], { path: "/tmp/music.mp3", kind: "music" }],
  ]),
  voicePath: "/tmp/voice.webm",
  assPath: "/tmp/subs.ass",
  fontsDir: "/tmp/fonts",
};

describe("sous-titres ASS", () => {
  it("convertit les couleurs et les temps", () => {
    expect(assColor("#FF5A36")).toBe("&H00365AFF");
    expect(assColor("#000000", 128)).toBe("&H80000000");
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.995)).toBe("0:01:02.00");
    expect(assTime(3725.5)).toBe("1:02:05.50");
  });

  it("neutralise les balises dans le texte", () => {
    expect(escapeAss("a {\\b1} b\nc")).toBe("a \\\\b1 b c");
  });

  it("écrit un fichier complet avec les polices du Brand Kit", () => {
    const ass = buildAss(samplePlan());
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("IBM Plex Sans");
    expect(ass.match(/^Dialogue:/gm)!.length).toBeGreaterThan(3);
    expect(ass).toContain("3 erreurs");
  });

  it("ajoute le filigrane seulement sur les offres qui en ont un", () => {
    expect(buildAss(samplePlan(), { watermarkText: "Fait avec Test" })).not.toContain("Fait avec Test");
    expect(buildAss(samplePlan({ watermark: true }), { watermarkText: "Fait avec Test" })).toContain(
      "Fait avec Test",
    );
  });
});

describe("commande FFmpeg", () => {
  const plan = samplePlan();
  const args = buildFfmpegArgs(plan, media, "/tmp/out.mp4");
  const graph = args[args.indexOf("-filter_complex") + 1]!;

  it("produit une vidéo H.264 + AAC au bon format", () => {
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("/tmp/out.mp4");
    expect(args.join(" ")).toMatch(/-r 30|fps=30/);
    expect(graph).toContain("1080");
    expect(graph).toContain("1920");
  });

  it("assemble chaque plan, incruste les sous-titres et le logo", () => {
    expect(graph).toContain("concat=n=");
    expect(graph).toContain("ass=");
    expect(graph).toContain("overlay");
  });

  it("baisse la musique sous la voix et normalise le volume", () => {
    // La voix arrive déjà nettoyée (lib/audio/voice.ts) : pas de second débruitage au rendu.
    expect(graph).not.toContain("afftdn");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("loudnorm=I=-14");
  });

  it("ne cite que des fichiers fournis", () => {
    const inputs = args.filter((_, i) => args[i - 1] === "-i");
    for (const input of inputs) {
      expect(
        ["/tmp/img.png", "/tmp/vid.mp4", "/tmp/logo.png", "/tmp/music.mp3", "/tmp/voice.webm"].some((p) =>
          input.includes(p),
        ) ||
          input.startsWith("color=") ||
          input.includes("anullsrc"),
      ).toBe(true);
    }
  });
});
