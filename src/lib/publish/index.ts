import { env } from "@/lib/env";
import type { Platform } from "@/lib/qc/rules";

export type ConnectedAccount = { platform: Platform; handle: string };

export interface Publisher {
  readonly name: string;
  /** Crée l'espace de publication de l'utilisateur et renvoie sa clé. */
  createProfile(userId: string): Promise<string>;
  /** Lien vers la page où l'utilisateur relie ses comptes TikTok, Instagram, YouTube. */
  linkUrl(profileKey: string): Promise<string>;
  connectedAccounts(profileKey: string): Promise<ConnectedAccount[]>;
  publish(req: {
    profileKey: string;
    platforms: Platform[];
    caption: string;
    videoUrl: string;
    scheduledAt: Date | null;
  }): Promise<Record<string, string>>;
}

const AYRSHARE_PLATFORMS: Record<Platform, string> = {
  tiktok: "tiktok",
  instagram: "instagram",
  youtube: "youtube",
};

/** Ayrshare : un service unique pour publier sur TikTok, Instagram et YouTube. */
export class AyrsharePublisher implements Publisher {
  readonly name = "ayrshare";
  private base = "https://api.ayrshare.com/api";
  constructor(private apiKey: string) {}

  private async call<T>(
    pathname: string,
    init: { method: string; body?: unknown; profileKey?: string },
  ): Promise<T> {
    const res = await fetch(`${this.base}${pathname}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.profileKey ? { "Profile-Key": init.profileKey } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { status?: string; message?: string };
    if (!res.ok || json.status === "error") throw new Error(`Publication : ${json.message ?? res.status}`);
    return json;
  }

  async createProfile(userId: string) {
    const r = await this.call<{ profileKey: string }>("/profiles", {
      method: "POST",
      body: { title: `user-${userId}` },
    });
    return r.profileKey;
  }

  async linkUrl(profileKey: string) {
    const e = env();
    const r = await this.call<{ url: string }>("/profiles/generateJWT", {
      method: "POST",
      body: {
        domain: process.env.AYRSHARE_DOMAIN,
        privateKey: process.env.AYRSHARE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        profileKey,
        redirect: `${e.APP_URL}/app`,
      },
    });
    return r.url;
  }

  async connectedAccounts(profileKey: string) {
    const r = await this.call<{
      activeSocialAccounts?: string[];
      displayNames?: { platform: string; username?: string; displayName?: string }[];
    }>("/user", { method: "GET", profileKey });
    const active = new Set(r.activeSocialAccounts ?? []);
    return (Object.keys(AYRSHARE_PLATFORMS) as Platform[])
      .filter((p) => active.has(AYRSHARE_PLATFORMS[p]))
      .map((p) => {
        const d = r.displayNames?.find((x) => x.platform === AYRSHARE_PLATFORMS[p]);
        return { platform: p, handle: d?.username ? `@${d.username}` : (d?.displayName ?? "compte relié") };
      });
  }

  async publish(req: {
    profileKey: string;
    platforms: Platform[];
    caption: string;
    videoUrl: string;
    scheduledAt: Date | null;
  }) {
    const r = await this.call<{
      id?: string;
      postIds?: { platform: string; id?: string; postUrl?: string }[];
    }>("/post", {
      method: "POST",
      profileKey: req.profileKey,
      body: {
        post: req.caption,
        platforms: req.platforms.map((p) => AYRSHARE_PLATFORMS[p]),
        mediaUrls: [req.videoUrl],
        isVideo: true,
        ...(req.scheduledAt ? { scheduleDate: req.scheduledAt.toISOString() } : {}),
        youTubeOptions: req.platforms.includes("youtube")
          ? { title: req.caption.slice(0, 95), shorts: true }
          : undefined,
      },
    });
    const ids: Record<string, string> = {};
    for (const p of r.postIds ?? []) if (p.id) ids[p.platform] = p.postUrl ?? p.id;
    if (r.id) ids.ayrshare = r.id;
    return ids;
  }
}

/** Publication simulée pour les tests : tous les comptes sont reliés, rien n'est envoyé. */
export class MockPublisher implements Publisher {
  readonly name = "mock";
  async createProfile(userId: string) {
    return `mock-${userId}`;
  }
  async linkUrl() {
    return "/app?compte=relie";
  }
  async connectedAccounts(): Promise<ConnectedAccount[]> {
    return [
      { platform: "tiktok", handle: "@compte_test" },
      { platform: "instagram", handle: "@compte_test" },
    ];
  }
  async publish(req: { platforms: Platform[] }) {
    return Object.fromEntries(req.platforms.map((p) => [p, `mock-${p}-${Date.now()}`]));
  }
}

let instance: Publisher | undefined;

export function publisher(): Publisher {
  if (instance) return instance;
  const e = env();
  if (e.PUBLISH_PROVIDER === "ayrshare") instance = new AyrsharePublisher(e.AYRSHARE_API_KEY!);
  else {
    if (e.NODE_ENV === "production" && process.env.ALLOW_MOCK_IN_PRODUCTION !== "1") {
      throw new Error("Publication non configurée (PUBLISH_PROVIDER=ayrshare et AYRSHARE_API_KEY).");
    }
    instance = new MockPublisher();
  }
  return instance;
}
