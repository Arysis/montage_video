import { env } from "@/lib/env";
import type { MusicMood } from "@/lib/script/schema";

/**
 * Musiques libres de droits trouvées selon l'ambiance choisie dans le script, quand le créateur
 * n'a pas fourni de fichier. Optionnelles selon les clés :
 * - Jamendo (clé client gratuite) : vrais morceaux instrumentaux, licence CC BY ou CC BY-SA
 *   seulement (usage commercial permis, crédit ajouté à la légende) ;
 * - Freesound (clé gratuite) : boucles musicales CC0, sans crédit obligatoire.
 */

export type MusicTrack = {
  source: "jamendo" | "freesound";
  id: string;
  url: string;
  durationSec: number;
  title: string;
  artist: string;
  /** Crédit à ajouter à la légende, ou null si la licence n'en demande pas (CC0). */
  attribution: string | null;
};

export interface MusicProvider {
  readonly name: MusicTrack["source"];
  search(mood: MusicMood, minSec: number): Promise<MusicTrack[]>;
}

const TIMEOUT = 10_000;

/** Mots-clés de recherche par ambiance (vocabulaire des deux banques). */
export const MOOD_TAGS: Record<MusicMood, { jamendo: string; freesound: string }> = {
  upbeat: { jamendo: "energetic+happy", freesound: "upbeat energetic music loop" },
  chill: { jamendo: "relaxing+chillout", freesound: "chill lofi music loop" },
  epic: { jamendo: "epic+cinematic", freesound: "epic cinematic music" },
  emotional: { jamendo: "emotional+piano", freesound: "emotional piano music" },
  corporate: { jamendo: "corporate+motivational", freesound: "corporate positive music" },
  funny: { jamendo: "funny+quirky", freesound: "funny quirky music loop" },
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "montage-video/1.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} : ${res.status}`);
  return res.json();
}

/** Licences Creative Commons qui permettent de monter et de publier, même sur un compte qui gagne de l'argent. */
export function commercialCc(licenseUrl: string | undefined): "CC BY" | "CC BY-SA" | null {
  if (!licenseUrl) return null;
  const m = licenseUrl.match(/licenses\/([a-z-]+)\//i);
  const kind = m?.[1]?.toLowerCase();
  if (kind === "by") return "CC BY";
  if (kind === "by-sa") return "CC BY-SA";
  return null;
}

type JamendoTracks = {
  results?: {
    id: string;
    name: string;
    artist_name: string;
    duration: number;
    audio: string;
    audiodownload?: string;
    audiodownload_allowed?: boolean;
    license_ccurl?: string;
  }[];
};

export class JamendoProvider implements MusicProvider {
  readonly name = "jamendo";
  constructor(private clientId: string) {}

  async search(mood: MusicMood, minSec: number): Promise<MusicTrack[]> {
    const res = (await getJson(
      `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(this.clientId)}&format=json&limit=40&fuzzytags=${MOOD_TAGS[mood].jamendo}&vocalinstrumental=instrumental&audioformat=mp32&order=popularity_total&durationbetween=${Math.max(20, Math.round(minSec))}_420`,
    )) as JamendoTracks;
    const out: MusicTrack[] = [];
    for (const t of res.results ?? []) {
      const license = commercialCc(t.license_ccurl);
      const url = t.audiodownload_allowed && t.audiodownload ? t.audiodownload : t.audio;
      if (!license || !url) continue;
      out.push({
        source: "jamendo",
        id: String(t.id),
        url,
        durationSec: t.duration,
        title: t.name,
        artist: t.artist_name,
        attribution: `Musique : « ${t.name} » par ${t.artist_name} (${license}, Jamendo)`,
      });
    }
    return out;
  }
}

type FreesoundResults = {
  results?: {
    id: number;
    name: string;
    username: string;
    duration: number;
    license: string;
    previews?: Record<string, string>;
  }[];
};

export class FreesoundProvider implements MusicProvider {
  readonly name = "freesound";
  constructor(private key: string) {}

  async search(mood: MusicMood, minSec: number): Promise<MusicTrack[]> {
    // Les boucles courtes sont jouées en boucle par le rendu : 15 s suffisent.
    const filter = encodeURIComponent(
      `license:"Creative Commons 0" duration:[${Math.min(15, Math.round(minSec))} TO 400]`,
    );
    const res = (await getJson(
      `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(MOOD_TAGS[mood].freesound)}&filter=${filter}&fields=id,name,username,duration,license,previews&sort=rating_desc&page_size=20&token=${encodeURIComponent(this.key)}`,
    )) as FreesoundResults;
    return (res.results ?? [])
      .filter((r) => r.previews?.["preview-hq-mp3"])
      .map((r) => ({
        source: "freesound" as const,
        id: String(r.id),
        url: r.previews!["preview-hq-mp3"]!,
        durationSec: r.duration,
        title: r.name,
        artist: r.username,
        attribution: null,
      }));
  }
}

export function musicProviders(): MusicProvider[] {
  const e = env();
  const list: MusicProvider[] = [];
  for (const name of e.MUSIC_PROVIDERS.split(",").map((s) => s.trim())) {
    if (name === "jamendo" && e.JAMENDO_CLIENT_ID) list.push(new JamendoProvider(e.JAMENDO_CLIENT_ID));
    if (name === "freesound" && e.FREESOUND_API_KEY) list.push(new FreesoundProvider(e.FREESOUND_API_KEY));
  }
  return list;
}

/** Choix stable mais varié d'une vidéo à l'autre : parmi les 6 premiers résultats, selon une graine. */
export async function findMusic(
  providers: MusicProvider[],
  mood: MusicMood,
  minSec: number,
  seed: number,
): Promise<MusicTrack | null> {
  for (const p of providers) {
    try {
      const tracks = (await p.search(mood, minSec)).slice(0, 6);
      if (tracks.length) return tracks[Math.abs(seed) % tracks.length]!;
    } catch (err) {
      console.error("[musique]", p.name, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
