import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureContrast, hexToHsl, hslToHex, MOODS, proposeBrandKits } from "@/lib/brand-assistant";
import { BUILT_IN_FAMILIES, boldFor } from "@/lib/fonts";
import { soundEffectsFor } from "@/lib/plan/build";
import { referencedAssetIds } from "@/lib/plan/schema";
import { contrastRatio } from "@/lib/qc/rules";
import { buildFfmpegArgs, buildSfxTrackArgs } from "@/lib/render/ffmpeg";
import { diversifyScript, normalizeScript } from "@/lib/script/schema";
import {
  CloudflareGenerator,
  FalGenerator,
  generateImage,
  type ImageGenerator,
  imagePrompt,
} from "@/lib/stock/ai-images";
import { commercialCc, findMusic, FreesoundProvider, JamendoProvider } from "@/lib/stock/music";
import { directions, samplePlan } from "../helpers/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("assistant de DA", () => {
  it("propose trois Brand Kits lisibles pour chaque ambiance", () => {
    for (const mood of MOODS) {
      for (const base of [null, "#3355FF", "#FFE066"]) {
        const kits = proposeBrandKits(mood, base);
        expect(kits).toHaveLength(3);
        for (const k of kits) {
          const c = Object.fromEntries(k.colors.map((x) => [x.name, x.hex]));
          expect(contrastRatio(c.Texte!, c.Fond!)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(c.Principale!, c.Fond!)).toBeGreaterThanOrEqual(3);
          for (const x of k.colors) expect(x.hex).toMatch(/^#[0-9A-F]{6}$/);
          expect(BUILT_IN_FAMILIES).toContain(k.titleFont);
          expect(BUILT_IN_FAMILIES).toContain(k.bodyFont);
        }
      }
    }
  });

  it("garde la couleur du créateur comme principale", () => {
    expect(proposeBrandKits("pro", "#ff5a36")[0]!.colors[0]!.hex).toBe("#FF5A36");
  });

  it("convertit les couleurs et corrige un contraste trop faible", () => {
    expect(hslToHex(0, 100, 50)).toBe("#FF0000");
    expect(hexToHsl("#FF0000")).toEqual([0, 100, 50]);
    const fixed = ensureContrast("#333333", "#111111", 4.5);
    expect(contrastRatio(fixed, "#111111")).toBeGreaterThanOrEqual(4.5);
  });

  it("ne met pas en gras artificiel les polices à graisse unique", () => {
    expect(boldFor("Anton")).toBe(false);
    expect(boldFor("Poppins")).toBe(true);
    expect(boldFor("Police importée")).toBe(true);
  });
});

describe("script plus varié", () => {
  const base = normalizeScript({
    title: "t",
    scenes: [1, 2, 3].map((i) => ({
      id: `s${i}`,
      text: "Une phrase.",
      effects: ["zoom-in"],
      background: "aurore",
      transition: "flash",
    })),
  });

  it("évite deux scènes de suite identiques et fait frapper l'accroche", () => {
    const out = diversifyScript(base);
    expect(out.scenes[0]!.effects.some((e) => e === "punch" || e === "shake")).toBe(true);
    for (let i = 1; i < out.scenes.length; i++) {
      const [a, b] = [out.scenes[i - 1]!, out.scenes[i]!];
      expect(b.effects.join()).not.toBe(a.effects.join());
      expect(b.background).not.toBe(a.background);
      if (b.transition !== "cut") expect(b.transition).not.toBe(a.transition);
    }
  });

  it("garde les anciens scripts valides (champs ajoutés par défaut)", () => {
    expect(base.soundEffects).toBe(true);
    expect(base.musicMood).toBeNull();
    expect(base.scenes[0]!.art).toBe("stock");
  });
});

describe("bruitages", () => {
  it("place un souffle sur les transitions marquées et un impact sur les zooms chocs", () => {
    const plan = samplePlan();
    expect(plan.sfx.some((x) => x.kind === "whoosh")).toBe(true);
    const scenes = plan.scenes.map((sc, i) => (i === 2 ? { ...sc, punches: [0.2, 0.3] } : sc));
    const sfx = soundEffectsFor(scenes);
    expect(sfx.some((x) => x.kind === "whoosh")).toBe(true);
    expect(sfx.some((x) => x.kind === "hit")).toBe(true);
    for (let i = 1; i < sfx.length; i++) expect(sfx[i]!.at - sfx[i - 1]!.at).toBeGreaterThanOrEqual(0.4);
    // Deux impacts trop proches : un seul est gardé.
    expect(sfx.filter((x) => x.kind === "hit")).toHaveLength(1);
  });

  it("les synthétise à part avec des filtres présents dans FFmpeg 5.1, puis les mélange", () => {
    const plan = samplePlan();
    const dir = mkdtempSync(path.join(tmpdir(), "sfx-"));
    const track = path.join(dir, "sfx.wav");
    const sfxArgs = buildSfxTrackArgs(plan, track)!;
    expect(sfxArgs.some((a) => a.startsWith("anoisesrc="))).toBe(true);
    // La piste se fabrique vraiment, et vite (pas de blocage du graphe).
    execFileSync("ffmpeg", sfxArgs, { timeout: 20_000 });
    expect(statSync(track).size).toBeGreaterThan(1000);
    expect(buildSfxTrackArgs({ ...plan, sfx: [] }, track)).toBeNull();
    const args = buildFfmpegArgs(
      plan,
      {
        assets: new Map(referencedAssetIds(plan).map((id) => [id, { path: "/tmp/img.png", kind: "image" }])),
        voicePath: null,
        assPath: "/tmp/a.ass",
        fontsDir: "/tmp/fonts",
        sfxPath: track,
      },
      "/tmp/out.mp4",
    );
    expect(args).toContain(track);
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("[mixfx]loudnorm");
  });

  it("s'arrêtent si le script les coupe", () => {
    expect(samplePlan({ directions: { ...directions, soundEffects: false } }).sfx).toEqual([]);
  });
});

describe("images IA", () => {
  it("ajoute une consigne de style sans texte", () => {
    expect(imagePrompt("  un cadenas  sur un écran ")).toMatch(
      /^un cadenas sur un écran\. Cinematic.*no text/,
    );
  });

  it("lit la réponse de Cloudflare (image en base64) et de fal.ai (lien)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.prompt).toContain("lock");
        if (url.includes("cloudflare"))
          return new Response(JSON.stringify({ result: { image: Buffer.from("jpeg").toString("base64") } }));
        expect((init.headers as Record<string, string>).Authorization).toBe("Key k");
        expect(body.image_size).toBe("portrait_16_9");
        return new Response(
          JSON.stringify({ images: [{ url: "https://fal/x.jpg", width: 576, height: 1024 }] }),
        );
      }),
    );
    const cf = await new CloudflareGenerator("acc", "tok").generate("lock", "portrait", 1);
    expect(cf.data?.toString()).toBe("jpeg");
    const fal = await new FalGenerator("k").generate("lock", "portrait", 1);
    expect(fal).toMatchObject({ url: "https://fal/x.jpg", width: 576, height: 1024, kind: "image" });
  });

  it("met de côté un générateur en panne pour le reste de la vidéo", async () => {
    const calls: string[] = [];
    const broken: ImageGenerator = {
      name: "cloudflare",
      generate: async () => {
        calls.push("cf");
        throw new Error("quota");
      },
    };
    const ok: ImageGenerator = {
      name: "pollinations",
      generate: async () => {
        calls.push("po");
        return {
          source: "pollinations",
          id: "1",
          kind: "image",
          url: "",
          data: Buffer.from("x"),
          width: 768,
          height: 1344,
          durationSec: null,
          credit: "IA",
        };
      },
    };
    const off = new Set<string>();
    expect(await generateImage([broken, ok], off, "p", "portrait", 1)).not.toBeNull();
    expect(await generateImage([broken, ok], off, "p", "portrait", 2)).not.toBeNull();
    expect(calls).toEqual(["cf", "po", "po"]);
  });
});

describe("musique libre", () => {
  it("n'accepte que les licences qui permettent un usage commercial", () => {
    expect(commercialCc("http://creativecommons.org/licenses/by/3.0/")).toBe("CC BY");
    expect(commercialCc("http://creativecommons.org/licenses/by-sa/3.0/")).toBe("CC BY-SA");
    expect(commercialCc("http://creativecommons.org/licenses/by-nc/3.0/")).toBeNull();
    expect(commercialCc("http://creativecommons.org/licenses/by-nd/3.0/")).toBeNull();
  });

  it("lit Jamendo (avec crédit) et Freesound (CC0, sans crédit)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("jamendo"))
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: "1",
                  name: "Nc",
                  artist_name: "A",
                  duration: 90,
                  audio: "https://j/1.mp3",
                  license_ccurl: "http://creativecommons.org/licenses/by-nc/3.0/",
                },
                {
                  id: "2",
                  name: "Run",
                  artist_name: "Bea",
                  duration: 120,
                  audio: "https://j/2.mp3",
                  license_ccurl: "http://creativecommons.org/licenses/by/3.0/",
                },
              ],
            }),
          );
        expect(decodeURIComponent(url)).toContain('license:"Creative Commons 0"');
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 9,
                name: "Loop",
                username: "u",
                duration: 30,
                license: "cc0",
                previews: { "preview-hq-mp3": "https://f/9.mp3" },
              },
            ],
          }),
        );
      }),
    );
    const jam = await new JamendoProvider("id").search("upbeat", 30);
    expect(jam.map((t) => t.id)).toEqual(["2"]);
    expect(jam[0]!.attribution).toContain("Bea");
    const fs = await new FreesoundProvider("k").search("chill", 30);
    expect(fs[0]).toMatchObject({ url: "https://f/9.mp3", attribution: null });
    expect(await findMusic([new JamendoProvider("id")], "upbeat", 30, 5)).toMatchObject({ id: "2" });
  });
});
