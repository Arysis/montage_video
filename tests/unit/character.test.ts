import { describe, expect, it } from "vitest";
import { mouthTrack, runs, voiceEnvelope } from "@/lib/character/mouth";
import { characterNameFrom, detectPose, groupCharacters } from "@/lib/character/poses";
import { characterBox, concatList } from "@/lib/character/render";
import { buildPlan } from "@/lib/plan/build";
import { referencedAssetIds } from "@/lib/plan/schema";
import { subtitleLayout } from "@/lib/plan/subtitles";
import { buildAss } from "@/lib/render/ass";
import { buildFfmpegArgs } from "@/lib/render/ffmpeg";
import { assets, brand, directions, IDS, script, wordsFor } from "../helpers/fixtures";

const CHAR = {
  closed: "66666666-6666-4666-8666-666666666661",
  open: "66666666-6666-4666-8666-666666666662",
  half: "66666666-6666-4666-8666-666666666663",
  blink: "66666666-6666-4666-8666-666666666664",
};

/** WAV PCM 16 bits mono : une liste de tranches [durée en s, amplitude 0-1]. */
function wav(parts: [number, number][], rate = 48000): Buffer {
  const samples = parts.reduce((n, [d]) => n + Math.round(d * rate), 0);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(samples * 2, 40);
  let i = 0;
  for (const [d, amp] of parts) {
    for (let k = 0; k < Math.round(d * rate); k++, i++) {
      buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amp * 32000), 44 + i * 2);
    }
  }
  return buf;
}

describe("poses d'un personnage", () => {
  it("devine la pose et le nom d'après le fichier", () => {
    expect(detectPose("renard-bouche-ouverte.png")).toBe("open");
    expect(detectPose("renard_mi-ouverte.png")).toBe("half");
    expect(detectPose("Renard yeux fermés.png")).toBe("blink");
    expect(detectPose("renard-bouche-fermee.png")).toBe("closed");
    expect(detectPose("renard.png")).toBe("closed");
    expect(characterNameFrom("renard-bouche-ouverte.png")).toBe("renard");
    expect(characterNameFrom("Renard_bouche_fermée.PNG")).toBe("renard");
    expect(characterNameFrom("Léo le lion - open.webp")).toBe("leo le lion");
  });

  it("regroupe les images d'un même personnage", () => {
    const groups = groupCharacters([
      { id: CHAR.open, kind: "character", characterName: "renard", pose: "open" },
      { id: CHAR.closed, kind: "character", characterName: "renard", pose: "closed" },
      { id: "x", kind: "character", characterName: null, pose: null },
      { id: "y", kind: "image", characterName: null, pose: null },
    ]);
    expect(groups).toHaveLength(2);
    const fox = groups.find((g) => g.name === "renard")!;
    expect(fox.mainId).toBe(CHAR.closed);
    expect(fox.canTalk).toBe(true);
    expect(fox.poses).toEqual({ closed: CHAR.closed, open: CHAR.open, half: null, blink: null });
    expect(groups.find((g) => g.mainId === "x")!.canTalk).toBe(false);
  });

  it("prend une autre image comme repos s'il manque la bouche fermée", () => {
    const [g] = groupCharacters([
      { id: "a", kind: "character", characterName: "chat", pose: "open" },
      { id: "b", kind: "character", characterName: "chat", pose: "half" },
    ]);
    expect(g!.mainId).toBe("a");
  });
});

describe("bouche synchronisée sur la voix", () => {
  // 1 s de silence, 1 s de voix forte, 1 s de silence.
  const env = voiceEnvelope(
    wav([
      [1, 0.001],
      [1, 0.8],
      [1, 0.001],
    ]),
  );

  it("mesure le volume par image", () => {
    expect(env.length).toBe(90);
    expect(env[15]!).toBeLessThan(-50);
    expect(env[45]!).toBeGreaterThan(-10);
  });

  it("ouvre la bouche seulement quand un mot est dit et que la voix est forte", () => {
    const track = mouthTrack(env, [{ start: 1, end: 2 }], {
      hasOpen: true,
      hasHalf: true,
      hasBlink: false,
      trimStart: 0,
      durationSec: 3,
    });
    expect(track).toHaveLength(90);
    expect(track.slice(0, 28)).toMatch(/^c+$/);
    expect(track.slice(62)).toMatch(/^c+$/);
    expect(track.slice(30, 60)).toMatch(/o/);
    // Pas de bouche grande ouverte plus de 8 images d'affilée.
    expect(runs(track).every(([l, n]) => l !== "o" || n <= 8)).toBe(true);
  });

  it("garde la bouche fermée sans image bouche ouverte, mais cligne des yeux", () => {
    const long = voiceEnvelope(wav([[10, 0.001]]));
    const track = mouthTrack(long, [{ start: 1, end: 2 }], {
      hasOpen: false,
      hasHalf: false,
      hasBlink: true,
      trimStart: 0,
      durationSec: 10,
    });
    expect(track).toMatch(/^[cb]+$/);
    expect(runs(track).filter(([l]) => l === "b").length).toBeGreaterThanOrEqual(2);
  });

  it("tient compte du début coupé de la prise", () => {
    const track = mouthTrack(env, [{ start: 1, end: 2 }], {
      hasOpen: true,
      hasHalf: false,
      hasBlink: false,
      trimStart: 1,
      durationSec: 2,
    });
    expect(track).toHaveLength(60);
    expect(track.slice(0, 30)).toMatch(/o/);
    expect(track.slice(35)).toMatch(/^c+$/);
  });

  it("écrit l'enchaînement des poses pour FFmpeg", () => {
    const list = concatList(
      "ccooc",
      new Map([
        ["c", "/w/c.png"],
        ["o", "/w/o.png"],
      ]),
    );
    expect(list).toBe(
      [
        "ffconcat version 1.0",
        "file '/w/c.png'",
        "duration 0.066667",
        "file '/w/o.png'",
        "duration 0.066667",
        "file '/w/c.png'",
        "duration 0.033333",
        "file '/w/c.png'",
        "",
      ].join("\n"),
    );
  });
});

describe("personnage dans le plan de montage", () => {
  const words = wordsFor(script.scenes.map((s) => s.text).join(" "));
  const duration = 30;
  const envelope = voiceEnvelope(wav([[duration, 0.5]]));
  const group = groupCharacters([
    { id: CHAR.closed, kind: "character", characterName: "renard", pose: "closed" },
    { id: CHAR.open, kind: "character", characterName: "renard", pose: "open" },
  ])[0]!;
  const build = (format: "9:16" | "16:9" | "1:1" = "9:16") =>
    buildPlan({
      format,
      script,
      take: { id: IDS["take-1"], durationSec: duration, words },
      // L'IA a mis le personnage en fond d'une scène : il doit être incrusté, pas en fond.
      directions: {
        ...directions,
        scenes: directions.scenes.map((s, i) => (i === 0 ? { ...s, assetIds: [CHAR.closed] } : s)),
      },
      assets: [
        ...assets,
        { id: CHAR.closed, kind: "character", durationSec: null },
        { id: CHAR.open, kind: "character", durationSec: null },
      ],
      brand,
      watermark: false,
      characters: [{ group, aspect: 0.75 }],
      voiceEnvelope: envelope,
    });

  it("fait parler le personnage dans toutes les scènes", () => {
    const plan = build();
    expect(plan.scenes.every((s) => s.character?.assetId === CHAR.closed && s.character.talking)).toBe(true);
    expect(
      plan.scenes.some(
        (s) => s.visual.type === "asset" && [CHAR.closed, CHAR.open].includes(s.visual.assetId),
      ),
    ).toBe(false);
    const rig = plan.characterRigs![CHAR.closed]!;
    expect(rig.mouth).toHaveLength(Math.round(plan.durationSec * 30));
    expect(rig.mouth).toMatch(/o/);
    expect(referencedAssetIds(plan)).toEqual(expect.arrayContaining([CHAR.closed, CHAR.open]));
  });

  it("place le personnage en bas et décale les sous-titres pour ne pas le cacher", () => {
    for (const format of ["9:16", "16:9", "1:1"] as const) {
      const plan = build(format);
      const box = plan.characterRigs![CHAR.closed]!.box;
      expect(box.y + box.h).toBe(plan.height);
      const layout = subtitleLayout(plan);
      const overlapsV = layout.rect.bottom > box.y;
      const overlapsH = plan.width - layout.marginR > box.x;
      expect(overlapsV && overlapsH).toBe(false);
    }
    const ass = buildAss(build("16:9"));
    expect(ass).toMatch(/Style: Sub,[^\n]*,\d+,(\d+),(\d+),/);
  });

  it("garde les cadres dans l'image", () => {
    for (const [f, W, H] of [
      ["9:16", 1080, 1920],
      ["1:1", 1080, 1080],
      ["16:9", 1920, 1080],
    ] as const) {
      for (const aspect of [0.4, 0.75, 1, 2.5]) {
        const b = characterBox(f, W, H, aspect);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(W);
        expect((b.w % 2) + (b.h % 2)).toBe(0);
      }
    }
  });

  it("incruste le personnage dans la commande FFmpeg", () => {
    const plan = build();
    const media = {
      assets: new Map([
        [IDS["img-1"], { path: "/tmp/img.png", kind: "image" }],
        [IDS["vid-1"], { path: "/tmp/vid.mp4", kind: "video" }],
        [IDS["logo-1"], { path: "/tmp/logo.png", kind: "logo" }],
        [IDS["music-1"], { path: "/tmp/music.mp3", kind: "music" }],
      ]),
      voicePath: "/tmp/voice.wav",
      assPath: "/tmp/subs.ass",
      fontsDir: "/tmp/fonts",
      characters: new Map([[CHAR.closed, "/tmp/char/mouth.ffconcat"]]),
    };
    const args = buildFfmpegArgs(plan, media, "/tmp/out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.join(" ")).toContain("-f concat -safe 0 -i /tmp/char/mouth.ffconcat");
    expect(graph).toMatch(/\[vcat\]\[char0\]overlay=/);
    expect(graph).toContain("[vchar0]");
  });
});
