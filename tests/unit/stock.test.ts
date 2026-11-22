import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findStock,
  fits,
  looksFrench,
  PexelsProvider,
  pickVideoFile,
  sceneQuery,
  type StockItem,
  type StockProvider,
} from "@/lib/stock";
import { script } from "../helpers/fixtures";

const item = (id: string, kind: StockItem["kind"] = "video"): StockItem => ({
  source: "pexels",
  id,
  kind,
  url: `https://x/${id}`,
  width: 1080,
  height: 1920,
  durationSec: kind === "video" ? 10 : null,
  credit: "Test",
});

describe("banques d'images libres", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("choisit le fichier vidéo le plus léger qui reste net", () => {
    const f = pickVideoFile([
      { width: 2160, height: 3840 },
      { width: 540, height: 960 },
      { width: 720, height: 1280 },
    ]);
    expect(f).toEqual({ width: 720, height: 1280 });
    expect(pickVideoFile([{ width: 360, height: 640 }])).toEqual({ width: 360, height: 640 });
  });

  it("vérifie que le cadre colle à la vidéo", () => {
    expect(fits(1080, 1920, "portrait")).toBe(true);
    expect(fits(1920, 1080, "portrait")).toBe(false);
    expect(fits(1920, 1080, "landscape")).toBe(true);
  });

  it("cherche avec le mot-clé du script, sinon ce qu'on voit, sinon le texte", () => {
    const s = script.scenes[0]!;
    expect(sceneQuery({ ...s, search: "padlock laptop" })).toBe("padlock laptop");
    expect(sceneQuery({ ...s, search: null, visualIntent: "Un cadenas sur un écran" })).toBe(
      "Un cadenas sur un écran",
    );
    expect(sceneQuery({ ...s, search: null, visualIntent: "Plan qui illustre la phrase" })).toBe(
      "Tu publies des vidéos et personne ne les",
    );
    expect(looksFrench("Un cadenas sur un écran")).toBe(true);
    expect(looksFrench("padlock laptop")).toBe(false);
  });

  it("passe à la banque suivante si la première échoue, et évite les doublons", async () => {
    const broken: StockProvider = { name: "pexels", search: () => Promise.reject(new Error("429")) };
    const ok: StockProvider = {
      name: "openverse",
      search: () => Promise.resolve([item("a", "image"), item("b"), item("c")]),
    };
    const found = await findStock([broken, ok], "q", "portrait", new Set(["pexels-b.mp4"]), 2);
    expect(found.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("lit les réponses de Pexels (vidéos verticales, puis photos)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        expect((init.headers as Record<string, string>).Authorization).toBe("cle");
        const body = url.includes("/videos/")
          ? {
              videos: [
                {
                  id: 7,
                  duration: 12,
                  user: { name: "Ana" },
                  video_files: [
                    { link: "https://v/hd.mp4", width: 1080, height: 1920, file_type: "video/mp4" },
                    { link: "https://v/sd.mp4", width: 540, height: 960, file_type: "video/mp4" },
                  ],
                },
              ],
            }
          : {
              photos: [
                { id: 9, width: 3000, height: 4500, photographer: "Bo", src: { large2x: "https://p/9.jpg" } },
              ],
            };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const items = await new PexelsProvider("cle").search("Un cadenas", "portrait");
    expect(items[0]).toMatchObject({
      kind: "video",
      url: "https://v/hd.mp4",
      durationSec: 12,
      credit: "Ana",
    });
    expect(items[1]).toMatchObject({ kind: "image", id: "p9", url: "https://p/9.jpg" });
    expect(calls[0]).toContain("orientation=portrait");
    expect(calls[0]).toContain("locale=fr-FR");
  });
});
