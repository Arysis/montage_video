import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import sharp from "sharp";
import {
  BACKGROUND_STYLES,
  diversifyScript,
  EFFECTS,
  MUSIC_MOODS,
  normalizeScript,
  PACES,
  sanitizeScript,
  type Script,
  type Structure,
  STRUCTURES,
  type Tone,
  TRANSITIONS,
} from "@/lib/script/schema";
import {
  assetDescriptionSchema,
  captionSchema,
  type AiProvider,
  type AssetSummary,
  type Caption,
  type ReviewIssue,
  type ReviseRequest,
  reviewSchema,
  type ScriptRequest,
} from "./types";

// Consignes courtes : elles sont renvoyées à chaque appel.
const SYSTEM = `Scénariste et monteur de vidéos courtes (TikTok, Reels, Shorts) pour créateurs solo. Français oral et naturel, tutoiement si le ton s'y prête.
Accroche dans les 3 premières secondes (question, promesse, contre-pied), une idée par scène, relance de l'attention à mi-vidéo, appel à l'action précis à la fin. Phrases de 15 mots au plus, mots concrets, aucune formule creuse.
N'invente aucun chiffre, témoignage ni fait non donné par le créateur.`;

/** Déroulé de chaque structure : une ligne, envoyée seulement pour la structure utile. */
const STRUCTURE_GUIDE: Record<Exclude<Structure, "auto">, string> = {
  probleme: "douleur du spectateur → pourquoi ça arrive → solution → exemple → action",
  liste: "promesse chiffrée (3 astuces…) → éléments numérotés, le plus surprenant d'abord → action",
  histoire: "moment fort → contexte → obstacle → déclic → leçon → action",
  "avant-apres": "le résultat d'abord → la situation avant → les étapes du changement → action",
  mythe: "idée reçue → pourquoi c'est faux → ce qui marche vraiment → action",
  tuto: "résultat final → étapes courtes et numérotées → erreur à éviter → action",
};
const TONE_GUIDE: Record<Exclude<Tone, "auto">, string> = {
  direct: "direct : phrases sèches, verbes d'action",
  drole: "drôle : autodérision, exagération, une chute",
  inspirant: "inspirant : images fortes, rythme qui monte",
  expert: "expert : mots précis, un conseil applicable par scène",
  calme: "posé : doux, rassurant, sans injonction",
};

// Ce que l'IA renvoie : clés courtes et ids de fichiers courts (f1, f2…) pour économiser les jetons.
const aiDirectionShape = {
  files: z.array(z.string()).max(4),
  bg: z.enum(BACKGROUND_STYLES),
  fx: z.array(z.enum(EFFECTS)).max(3),
  next: z.enum(TRANSITIONS),
  onScreen: z.string().max(60).nullable(),
  character: z.object({ file: z.string(), talking: z.boolean() }).nullable(),
  emphasis: z.array(z.string()).max(3),
  search: z.string().max(60),
  art: z.enum(["stock", "ai"]),
};
const aiScriptSchema = z.object({
  title: z.string().max(80),
  structure: z.enum(STRUCTURES),
  pace: z.enum(PACES),
  music: z.string().nullable(),
  mood: z.enum(MUSIC_MOODS).nullable(),
  scenes: z
    .array(z.object({ text: z.string(), visual: z.string().max(120), ...aiDirectionShape }))
    .min(1)
    .max(10),
  caption: z.string().max(400),
  hashtags: z.array(z.string()).max(5),
});
const aiReviseSchema = z.object({
  scenes: z.array(z.object({ id: z.string(), ...aiDirectionShape })).max(12),
});
type AiDirection = { [K in keyof typeof aiDirectionShape]: z.infer<(typeof aiDirectionShape)[K]> };

/** Ids courts pour l'IA (f1, f2…) et leur correspondance avec les vrais ids. */
function shortIds(assets: AssetSummary[]) {
  const toShort = new Map(assets.map((a, i) => [a.id, `f${i + 1}`]));
  const toLong = new Map(assets.map((a, i) => [`f${i + 1}`, a.id]));
  return {
    short: (id: string | null) => (id ? (toShort.get(id) ?? null) : null),
    long: (f: string) => toLong.get(f),
  };
}

const DIRECTION_RULES = `Pour chaque scène (varie tout d'une scène à l'autre) :
- files : fichiers à montrer (ids f…, vidéos/images), 2 si la scène dure plus de 4 s ; [] si aucun ne colle.
- art : sans fichier, "stock" si une vraie vidéo existe sûrement en banque (gestes, lieux, objets), "ai" pour une idée abstraite, une métaphore ou une scène impossible à filmer.
- search : 2 à 4 mots-clés concrets en anglais décrivant l'image voulue.
- bg : fond animé si files est vide ou derrière un personnage (aurore, nuit, particules, degrade).
- fx : 1 ou 2 parmi zoom-in, zoom-out, pan, punch (zoom choc sur un mot fort), shake (secousse) ; punch ou shake sur l'accroche.
- next : transition vers la suivante (cut, fade, slide, zoom, flash, wipe, blur) ; surtout cut, une transition marquée aux changements d'idée.
- onScreen : texte à l'écran de 5 mots max s'il aide (étape numérotée, mot clé), sinon null.
- character : un fichier character s'il apparaît, talking=true s'il dit le texte ; sinon null.
- emphasis : 0 à 2 mots forts tirés du texte dit.`;

type Content = Anthropic.Beta.Messages.BetaContentBlockParam;

function describeAssets(assets: AssetSummary[], short: (id: string) => string | null): string {
  if (!assets.length) return "Aucun.";
  return assets
    .map(
      (a) =>
        `${short(a.id)} ${a.kind} « ${a.name.slice(0, 40)} »${a.durationSec ? ` ${a.durationSec.toFixed(0)} s` : ""}${a.description ? ` : ${a.description.slice(0, 120)}` : ""}`,
    )
    .join("\n");
}

function fromAi(d: AiDirection, long: (f: string) => string | undefined) {
  const characterId = d.character ? long(d.character.file) : undefined;
  return {
    visuals: d.files.map((f) => long(f)).filter((x): x is string => !!x),
    background: d.bg,
    effects: d.fx.length ? d.fx : (["zoom-in"] as const).slice(),
    transition: d.next,
    onScreenText: d.onScreen,
    character: characterId ? { assetId: characterId, talking: !!d.character?.talking } : null,
    emphasis: d.emphasis,
    search: d.search || null,
    art: d.art,
  };
}

function toAi(s: Script["scenes"][number], short: (id: string | null) => string | null): AiDirection {
  const character = s.character ? short(s.character.assetId) : null;
  return {
    files: s.visuals.map((id) => short(id)).filter((x): x is string => !!x),
    bg: s.background,
    fx: s.effects,
    next: s.transition,
    onScreen: s.onScreenText,
    character: character ? { file: character, talking: !!s.character?.talking } : null,
    emphasis: s.emphasis,
    search: s.search ?? "",
    art: s.art,
  };
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  /** Appel structuré : la réponse est validée par le schéma Zod. */
  private async ask<T extends z.ZodType>(
    schema: T,
    content: string | Content[],
    effort: "low" | "medium" | "high",
    maxTokens = 16000,
  ): Promise<z.infer<T>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      system: SYSTEM,
      // Les petites tâches (légende, description, relecture) n'ont pas besoin de réflexion :
      // on la coupe pour ne pas payer de jetons inutiles.
      thinking: effort === "low" ? { type: "disabled" } : { type: "adaptive" },
      output_config: { effort, format: zodOutputFormat(schema) },
      // Si un filtre de sécurité refuse la demande, l'API relance sur un modèle de repli.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("L'IA a refusé cette demande. Reformule ton idée.");
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new Error("Réponse de l'IA incomplète. Réessaie.");
    }
    return response.parsed_output as z.infer<T>;
  }

  async generateScript(req: ScriptRequest): Promise<Script> {
    const ids = shortIds(req.assets);
    const structure = req.structure && req.structure !== "auto" ? req.structure : null;
    const tone = req.tone && req.tone !== "auto" ? TONE_GUIDE[req.tone] : null;
    const prompt = `Écris le script détaillé d'une vidéo : texte dit, visuels, fonds, effets et transitions. Le montage suivra ce script à la lettre.

Idée du créateur :
"""${req.idea}"""

Format ${req.format}, plateformes : ${req.platforms.join(", ") || "non précisées"}. Durée visée ${req.targetDurationSec} s, soit environ ${Math.round(req.targetDurationSec * 2.6)} mots dits au total.
${
  structure
    ? `Structure imposée (${structure}) : ${STRUCTURE_GUIDE[structure]}.`
    : `structure : choisis la plus efficace pour cette idée parmi ${Object.entries(STRUCTURE_GUIDE)
        .map(([k, v]) => `${k} (${v})`)
        .join(" ; ")}.`
}
${tone ? `Ton ${tone}.` : "Ton : celui qui sert le mieux l'idée."}

Fichiers du créateur (à utiliser en priorité) :
${describeAssets(req.assets, ids.short)}

${Math.max(3, Math.min(8, Math.round(req.targetDurationSec / 6)))} scènes environ. text : 1 à 3 phrases dites. visual : ce qu'on voit en une phrase, en alternant gros plans, plans larges, mains en action, écrans, lieux.
${DIRECTION_RULES}
pace : calm, normal ou fast. music : un fichier music ou null ; mood : sans fichier music, ambiance d'une musique libre (upbeat, chill, epic, emotional, corporate, funny) ou null.
caption : légende de publication (2 phrases max). hashtags : 3 à 5, avec #.`;
    const out = await this.ask(aiScriptSchema, prompt, "medium");
    const script = normalizeScript({
      title: out.title,
      pace: out.pace,
      musicAssetId: out.music ? (ids.long(out.music) ?? null) : null,
      musicMood: out.mood,
      structure: structure ?? out.structure,
      tone: req.tone ?? null,
      caption: out.caption,
      hashtags: out.hashtags,
      scenes: out.scenes.map((s, i) => ({
        id: `s${i + 1}`,
        text: s.text,
        visualIntent: s.visual,
        ...fromAi(s, ids.long),
      })),
    });
    return diversifyScript(sanitizeScript(script, new Set(req.assets.map((a) => a.id))));
  }

  async reviseScript(req: ReviseRequest): Promise<Script> {
    const ids = shortIds(req.assets);
    const scenes = req.script.scenes
      .filter((s) => !req.sceneId || s.id === req.sceneId)
      .map((s) => `${s.id} « ${s.text} » ${JSON.stringify(toAi(s, ids.short))}`)
      .join("\n");
    const prompt = `Corrige le montage de cette vidéo. Le texte est déjà enregistré : ne change que les choix de montage.

Demande du créateur${req.sceneId ? ` (scène ${req.sceneId} seulement)` : ""} :
"""${req.instruction}"""

Scènes actuelles :
${scenes}

Fichiers :
${describeAssets(req.assets, ids.short)}

${DIRECTION_RULES}
Renvoie uniquement les scènes à modifier, avec leur id.`;
    const out = await this.ask(aiReviseSchema, prompt, "low", 4000);
    const byId = new Map(out.scenes.map((s) => [s.id, s]));
    const next = {
      ...req.script,
      scenes: req.script.scenes.map((s) => {
        const change = byId.get(s.id);
        if (!change || (req.sceneId && s.id !== req.sceneId)) return s;
        return { ...s, ...fromAi(change, ids.long) };
      }),
    };
    return sanitizeScript(normalizeScript(next), new Set(req.assets.map((a) => a.id)));
  }

  async reviewFrames(req: {
    script: Script;
    frames: { sceneId: string; jpeg: Buffer; spokenText: string }[];
  }): Promise<ReviewIssue[]> {
    const content: Content[] = [
      {
        type: "text",
        text: `Voici une image extraite au milieu de chaque plan d'une vidéo verticale, avec ce qui est dit pendant ce plan.
Signale uniquement ce qui semble vraiment faux : visage coupé, personnage incohérent d'un plan à l'autre, texte mal orthographié, plan sans rapport avec ce qui est dit, image illisible.
Sévérité "fail" seulement pour une faute d'orthographe visible ou une image clairement cassée. Sinon "warn".
Si tout va bien, renvoie une liste vide.`,
      },
    ];
    for (const f of req.frames) {
      content.push({ type: "text", text: `Plan ${f.sceneId} : « ${f.spokenText} »` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") },
      });
    }
    const result = await this.ask(reviewSchema, content, "low", 2000);
    return result.issues;
  }

  async proposeCaption(req: { script: Script; platforms: string[]; previous?: string }): Promise<Caption> {
    const prompt = `Écris la légende de publication de cette vidéo pour ${req.platforms.join(", ") || "les réseaux"}.
Script : ${req.script.scenes.map((s) => s.text).join(" ")}
${req.previous ? `Propose autre chose que : """${req.previous}"""` : ""}
Deux phrases au plus, qui donnent envie de regarder sans dévoiler la fin. Ajoute 3 à 5 hashtags pertinents avec le #.`;
    return this.ask(captionSchema, prompt, "low", 1000);
  }

  async describeImage(req: { jpeg: Buffer; name: string; kind: string }): Promise<string | null> {
    // Une petite image suffit pour la décrire, et coûte bien moins de jetons.
    const small = await sharp(req.jpeg).resize(384, 384, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
    const result = await this.ask(
      assetDescriptionSchema,
      [
        {
          type: "text",
          text: `Décris en une phrase ce que montre ce fichier (${req.kind}, « ${req.name} »), pour qu'un monteur sache quand l'utiliser.`,
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") },
        },
      ],
      "low",
      1000,
    );
    return result.description;
  }
}
