import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/lib/db";
import {
  addAutoMusic,
  type ImageGenerator,
  illustrateScript,
  type MusicProvider,
  type StockProvider,
} from "@/lib/stock";
import { normalizeScript } from "@/lib/script/schema";
import { makeImage, setupIntegration } from "./setup";

let root = "";
let userId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  root = await setupIntegration();
  const [user] = await db()
    .insert(schema.users)
    .values({ email: "stock@example.com", passwordHash: "x" })
    .returning();
  userId = user!.id;
  const image = makeImage(root, "0x884422");
  const video = path.join(root, "clip.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=360x640:d=2",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  server = createServer((req, res) => {
    res.end(readFileSync(req.url?.endsWith(".mp4") ? video : image));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await closeDb();
});

describe("illustration des scènes sans fichier", () => {
  it("ajoute une vidéo libre par scène vide, une seule fois", async () => {
    const queries: string[] = [];
    const provider: StockProvider = {
      name: "pexels",
      search: async (q) => {
        queries.push(q);
        return [
          {
            source: "pexels",
            id: `v${queries.length}`,
            kind: "video",
            url: `${base}/v${queries.length}.mp4`,
            width: 360,
            height: 640,
            durationSec: 2,
            credit: "Ana",
          },
          {
            source: "pexels",
            id: `p${queries.length}`,
            kind: "image",
            url: `${base}/p.png`,
            width: 720,
            height: 1280,
            durationSec: null,
            credit: "Bo",
          },
        ];
      },
    };
    const script = normalizeScript({
      title: "HTTPS",
      scenes: [
        { id: "s1", text: "Ton mot de passe voyage en clair.", search: "padlock laptop" },
        { id: "s2", text: "Le cadenas protège tout.", visuals: ["déjà-là"] },
      ],
    });
    const run = () =>
      illustrateScript({
        userId,
        script,
        orientation: "portrait",
        work: path.join(root, "w"),
        providers: [provider],
      });
    const first = await run();
    expect(queries).toEqual(["padlock laptop"]);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ kind: "video", rights: "free", name: "pexels-v1.mp4" });
    expect(first.script.scenes[0]!.visuals).toEqual([first.added[0]!.id]);
    expect(first.script.scenes[1]!.visuals).toEqual(["déjà-là"]);
    // Même résultat une deuxième fois : pas de doublon dans la bibliothèque.
    queries.length = 0;
    await run();
    const rows = await db().select().from(schema.assets).where(eq(schema.assets.userId, userId));
    expect(rows.filter((r) => r.name === "pexels-v1.mp4")).toHaveLength(1);
  });

  it("garde le fond animé si aucune banque ne répond", async () => {
    const script = normalizeScript({ title: "x", scenes: [{ id: "s1", text: "Bonjour." }] });
    const res = await illustrateScript({
      userId,
      script,
      orientation: "portrait",
      work: path.join(root, "w"),
      providers: [{ name: "openverse", search: () => Promise.reject(new Error("hors ligne")) }],
    });
    expect(res.script.scenes[0]!.visuals).toEqual([]);
  });

  it("crée une image IA quand le script le demande ou que les banques ne trouvent rien", async () => {
    const png = readFileSync(makeImage(root, "0x2244aa"));
    const prompts: string[] = [];
    const generator: ImageGenerator = {
      name: "pollinations",
      generate: async (prompt, _o, seed) => {
        prompts.push(prompt);
        return {
          source: "pollinations",
          id: `g${seed}`,
          kind: "image",
          url: "",
          data: png,
          width: 768,
          height: 1344,
          durationSec: null,
          credit: "Image IA (Flux, Pollinations)",
        };
      },
    };
    const stockQueries: string[] = [];
    const script = normalizeScript({
      title: "x",
      scenes: [
        { id: "s1", text: "Ta motivation est une flamme.", art: "ai", search: "glowing flame heart" },
        { id: "s2", text: "Rien en banque.", search: "nothing" },
      ],
    });
    const res = await illustrateScript({
      userId,
      script,
      orientation: "portrait",
      work: path.join(root, "w"),
      providers: [{ name: "openverse", search: async (q) => (stockQueries.push(q), []) }],
      generators: [generator],
      maxAiImages: 6,
    });
    // Scène 1 : l'IA d'abord, sans chercher en banque. Scène 2 : banque vide, puis l'IA.
    expect(stockQueries).toEqual(["nothing"]);
    expect(prompts[0]).toContain("glowing flame heart");
    expect(res.added).toHaveLength(2);
    expect(res.added[0]).toMatchObject({ kind: "image", rights: "free", mime: "image/jpeg" });
    expect(res.added[0]!.description).toContain("Image IA");
    expect(res.script.scenes.every((sc) => sc.visuals.length === 1)).toBe(true);
  });

  it("ajoute une musique libre selon l'ambiance, avec son crédit dans la légende", async () => {
    const provider: MusicProvider = {
      name: "jamendo",
      search: async (mood) => {
        expect(mood).toBe("upbeat");
        return [
          {
            source: "jamendo",
            id: "42",
            url: `${base}/m.mp3`,
            durationSec: 120,
            title: "Run",
            artist: "Bea",
            attribution: "Musique : « Run » par Bea (CC BY, Jamendo)",
          },
        ];
      },
    };
    const script = normalizeScript({
      title: "x",
      caption: "Regarde ça.",
      musicMood: "upbeat",
      scenes: [{ id: "s1", text: "Bonjour." }],
    });
    const res = await addAutoMusic({
      userId,
      script,
      minSec: 20,
      seed: 3,
      work: path.join(root, "w"),
      providers: [provider],
    });
    expect(res.added).toMatchObject({ kind: "music", name: "jamendo-42.mp3", rights: "free" });
    expect(res.script.musicAssetId).toBe(res.added!.id);
    expect(res.script.caption).toBe("Regarde ça.\n\nMusique : « Run » par Bea (CC BY, Jamendo)");
    // Un fichier musique déjà choisi n'est jamais remplacé.
    const kept = await addAutoMusic({
      userId,
      script: { ...script, musicAssetId: "mien" },
      minSec: 20,
      seed: 3,
      work: path.join(root, "w"),
      providers: [provider],
    });
    expect(kept.added).toBeNull();
  });
});
