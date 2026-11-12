import { describe, expect, it } from "vitest";
import { alignWords, normalizeToken, sceneSpans, tokenize } from "@/lib/plan/align";
import { brandPalette, buildPlan } from "@/lib/plan/build";
import { maxShotSeconds } from "@/lib/plan/directions";
import { editPlanSchema, referencedAssetIds } from "@/lib/plan/schema";
import { buildCues, safeZone, wrapLines } from "@/lib/plan/subtitles";
import { assets, brand, directions, IDS, samplePlan, script, wordsFor } from "../helpers/fixtures";

describe("alignement voix et script", () => {
  it("normalise les mots (accents, ponctuation, casse)", () => {
    expect(normalizeToken("Écoute,")).toBe("ecoute");
    expect(tokenize("Tu veux ? Vraiment !")).toEqual(["tu", "veux", "vraiment"]);
  });

  it("aligne malgré un mot ajouté et un mot oublié", () => {
    const map = alignWords(["le", "chat", "dort", "ici"], ["euh", "le", "chat", "dort"]);
    expect(map).toEqual([1, 2, 3, -1]);
  });

  it("trouve la plage de chaque scène", () => {
    const words = wordsFor(script.scenes.map((s) => s.text).join(" "));
    const spans = sceneSpans(script.scenes, words);
    expect(spans.map((s) => s.sceneId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(spans[0]!.firstWord).toBe(0);
    expect(spans[3]!.lastWord).toBe(words.length - 1);
    for (const s of spans) expect(s.coverage).toBeGreaterThan(0.9);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.firstWord).toBe(spans[i - 1]!.lastWord + 1);
  });

  it("garde des plages contiguës quand une scène n'est pas lue", () => {
    const spoken = [script.scenes[0]!.text, script.scenes[2]!.text, script.scenes[3]!.text].join(" ");
    const spans = sceneSpans(script.scenes, wordsFor(spoken));
    expect(spans).toHaveLength(4);
    expect(spans[1]!.coverage).toBe(0);
  });
});

describe("plan de montage", () => {
  it("produit un plan valide calé sur la voix", () => {
    const plan = samplePlan();
    expect(editPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.scenes[0]!.start).toBe(0);
    expect(plan.voice!.trimStart).toBeCloseTo(0.3, 2);
    for (let i = 1; i < plan.scenes.length; i++)
      expect(plan.scenes[i]!.start).toBeCloseTo(plan.scenes[i - 1]!.end, 2);
    expect(plan.scenes[plan.scenes.length - 1]!.end).toBe(plan.durationSec);
  });

  it("découpe les scènes longues en plans plus courts", () => {
    const plan = samplePlan({ directions: { ...directions, pace: "fast" } });
    const max = maxShotSeconds("fast");
    for (const s of plan.scenes.filter((x) => x.visual.type === "asset")) {
      expect(s.end - s.start).toBeLessThanOrEqual(max + 0.01);
    }
  });

  it("utilise un fond de couleur quand la scène n'a pas de visuel", () => {
    const plan = samplePlan();
    const last = plan.scenes[plan.scenes.length - 1]!;
    expect(last.visual).toEqual({ type: "color", color: "#0E0F11" });
  });

  it("place le logo et la musique du Brand Kit", () => {
    const plan = samplePlan();
    expect(plan.logo?.assetId).toBe("33333333-3333-4333-8333-333333333333");
    expect(plan.logo?.showFrom).toBe(0);
    expect(plan.music?.assetId).toBe("44444444-4444-4444-8444-444444444444");
    expect(referencedAssetIds(plan).sort()).toEqual(
      [IDS["img-1"], IDS["vid-1"], IDS["logo-1"], IDS["music-1"]].sort(),
    );
  });

  it("ignore un fichier inconnu proposé par l'IA", () => {
    const plan = samplePlan({
      directions: { ...directions, scenes: directions.scenes.map((s) => ({ ...s, assetIds: ["inconnu"] })) },
    });
    expect(plan.scenes.every((s) => s.visual.type === "color")).toBe(true);
  });

  it("refuse une prise sans mot", () => {
    expect(() =>
      buildPlan({
        format: "9:16",
        script,
        take: { id: "t", durationSec: 5, words: [] },
        directions,
        assets,
        brand,
        watermark: false,
      }),
    ).toThrow(/aucun mot/);
  });

  it("lit la palette par nom, avec des valeurs par défaut", () => {
    expect(brandPalette([])).toEqual({ primary: "#FF5A36", background: "#0E0F11", text: "#F2EFE9" });
    expect(brandPalette([{ name: "primary", hex: "#112233" }]).primary).toBe("#112233");
  });
});

describe("sous-titres", () => {
  it("reste dans la zone sûre de TikTok en vertical", () => {
    const z = safeZone({ format: "9:16", width: 1080, height: 1920 });
    expect(z.bottom).toBeGreaterThanOrEqual(400);
    expect(z.right).toBeGreaterThan(z.left);
  });

  it("coupe les répliques à 2,5 s au plus et suit l'ordre des mots", () => {
    const plan = samplePlan();
    const cues = buildCues(plan);
    expect(cues.length).toBeGreaterThan(2);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(2.9);
    expect(cues.flatMap((c) => c.words).length).toBe(plan.subtitles.words.length);
  });

  it("répartit le texte en lignes courtes", () => {
    const lines = wrapLines("Commence par ce que la personne va gagner tout de suite", 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
  });
});
