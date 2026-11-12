"use client";

import { MagnifyingGlass, Trash, UploadSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteAsset, updateAsset } from "@/app/actions/assets";
import { FormError } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import f from "./forms.module.css";
import l from "./library.module.css";
import { useUpload } from "./useUpload";

type Kind = "logo" | "character" | "video" | "image" | "music" | "font";
export type LibraryAsset = {
  id: string;
  name: string;
  kind: Kind;
  mime: string;
  sizeBytes: number;
  rights: "own" | "licensed" | "free" | "unknown";
  createdAt: string;
  thumbKey: string | null;
  storageKey: string;
  durationSec: number | null;
  fontFamily: string | null;
  analyzed: boolean;
  uses: number;
  characterName: string | null;
  pose: "closed" | "half" | "open" | "blink" | null;
};

const POSE_LABELS = {
  closed: "Bouche fermée",
  half: "Bouche mi-ouverte",
  open: "Bouche ouverte",
  blink: "Yeux fermés",
} as const;

const KIND_LABELS: Record<Kind, string> = {
  logo: "Logo",
  character: "Personnage",
  video: "Vidéo",
  image: "Image",
  music: "Musique",
  font: "Police",
};
const TABS: { kind: Kind | "all"; label: string }[] = [
  { kind: "all", label: "Tout" },
  { kind: "logo", label: "Logos" },
  { kind: "character", label: "Personnages" },
  { kind: "video", label: "Vidéos" },
  { kind: "image", label: "Images" },
  { kind: "music", label: "Musiques" },
  { kind: "font", label: "Polices" },
];
const RIGHTS_LABELS = {
  own: "Je l'ai créé",
  licensed: "Sous licence",
  free: "Libre de droits",
  unknown: "Je ne sais pas",
} as const;

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} Go`;
}
const ext = (name: string) => (name.split(".").pop() ?? "").toUpperCase();

function Preview({ asset, large }: { asset: LibraryAsset; large?: boolean }) {
  if (large && asset.kind === "video") {
    return (
      <video src={`/api/files/${asset.storageKey}`} controls preload="metadata" className={l.previewMedia} />
    );
  }
  if (large && asset.kind === "music") {
    return (
      <div className={l.previewBox}>
        <audio src={`/api/files/${asset.storageKey}`} controls preload="none" style={{ width: "90%" }} />
      </div>
    );
  }
  if (asset.thumbKey) {
    return (
      <img src={`/api/files/${asset.thumbKey}`} alt="" className={large ? l.previewMedia : l.thumbImg} />
    );
  }
  return (
    <div className={`placeholder-frame ${large ? l.previewBox : l.thumbBox}`}>
      {asset.analyzed ? ext(asset.name) : "Analyse…"}
    </div>
  );
}

export function Library({ assets }: { assets: LibraryAsset[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(assets[0]?.id ?? null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const { items, upload, remove } = useUpload(() => router.refresh());

  // Tant qu'un fichier est en analyse, on rafraîchit la liste.
  const analyzing = assets.some((a) => !a.analyzed);
  useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [analyzing, router]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(
      (a) => (tab === "all" || a.kind === tab) && (!q || a.name.toLowerCase().includes(q)),
    );
  }, [assets, tab, query]);
  const selected = assets.find((a) => a.id === selectedId) ?? assets[0] ?? null;

  const characterNames = useMemo(
    () => [...new Set(assets.map((a) => a.characterName).filter((n): n is string => !!n))],
    [assets],
  );
  const siblings = selected?.characterName
    ? assets.filter((a) => a.kind === "character" && a.characterName === selected.characterName)
    : [];

  const change = (patch: { kind?: string; rights?: string; characterName?: string; pose?: string }) => {
    if (!selected) return;
    setError(undefined);
    startTransition(async () => {
      const res = await updateAsset(selected.id, patch);
      if (res.error) setError(res.error);
      router.refresh();
    });
  };
  const destroy = () => {
    if (!selected) return;
    const warn = selected.uses ? ` Il sert dans ${selected.uses} vidéo${selected.uses > 1 ? "s" : ""}.` : "";
    if (!window.confirm(`Supprimer ${selected.name} ?${warn} Cette action est définitive.`)) return;
    startTransition(async () => {
      const res = await deleteAsset(selected.id);
      if (res.error) setError(res.error);
      else setSelectedId(null);
      router.refresh();
    });
  };

  return (
    <>
      <TopBar
        title="Bibliothèque"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
            <UploadSimple size={20} aria-hidden="true" />
            Importer mes fichiers
          </button>
        }
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.ogg,.ttf,.otf"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files, tab === "all" ? undefined : tab);
          e.target.value = "";
        }}
      />
      <div className={styles.body}>
        <section className={styles.content} aria-label="Tes fichiers">
          <div className="tabs" role="tablist" aria-label="Type de fichier">
            {TABS.map((t) => (
              <button
                key={t.kind}
                type="button"
                role="tab"
                aria-selected={tab === t.kind}
                className="tab"
                style={{
                  background: tab === t.kind ? undefined : "none",
                  border: tab === t.kind ? undefined : 0,
                  cursor: "pointer",
                }}
                onClick={() => setTab(t.kind)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className={l.search}>
            <MagnifyingGlass size={20} aria-hidden="true" />
            <label htmlFor="asset-search" className="sr-only">
              Rechercher un fichier
            </label>
            <input
              id="asset-search"
              type="search"
              className="input"
              placeholder="Rechercher"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {items.some((i) => !i.asset) && (
            <ul className={f.chips} aria-label="Imports en cours" style={{ marginBottom: 16 }}>
              {items
                .filter((i) => !i.asset)
                .map((i) => (
                  <li key={i.key} className={f.chip} data-error={i.error ? true : undefined}>
                    {i.name} {i.error ? `· ${i.error}` : `· ${Math.round(i.progress * 100)} %`}
                    {i.error && (
                      <button type="button" aria-label="Fermer" onClick={() => remove(i.key)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}

          {visible.length === 0 ? (
            <div className={l.empty}>
              <p className="h3">
                {assets.length ? "Aucun fichier ne correspond." : "Ta bibliothèque est vide."}
              </p>
              <p className="muted">
                Importe ton logo, tes images, tes vidéos et tes musiques. L&apos;IA s&apos;en sert pour monter
                tes vidéos.
              </p>
            </div>
          ) : (
            <ul className={l.grid}>
              {visible.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`card card-hover ${l.item} ${a.id === selected?.id ? "card-selected" : ""}`}
                    aria-pressed={a.id === selected?.id}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <Preview asset={a} />
                    <span className={l.itemName}>
                      {a.kind === "font" && a.fontFamily ? a.fontFamily : a.name}
                    </span>
                    <span className="caption subtle">
                      {a.kind === "character" && a.characterName
                        ? `${a.characterName} · ${POSE_LABELS[a.pose ?? "closed"].toLowerCase()}`
                        : KIND_LABELS[a.kind]}
                      {a.rights === "unknown" ? " · droits à préciser" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={styles.panel} aria-label="Détail du fichier">
          {selected ? (
            <>
              <Preview asset={selected} large />
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, wordBreak: "break-all" }}>
                  {selected.name}
                </h2>
                <p className="muted">{KIND_LABELS[selected.kind]}</p>
              </div>
              <dl className={f.summary}>
                <dt>Format</dt>
                <dd>{ext(selected.name)}</dd>
                <dt>Taille</dt>
                <dd className="tabular">{formatBytes(selected.sizeBytes)}</dd>
                {selected.durationSec != null && (
                  <>
                    <dt>Durée</dt>
                    <dd className="tabular">{selected.durationSec.toFixed(1).replace(".", ",")} s</dd>
                  </>
                )}
                <dt>Ajouté le</dt>
                <dd>{dateFmt.format(new Date(selected.createdAt))}</dd>
                <dt>Utilisé dans</dt>
                <dd>
                  {selected.uses} vidéo{selected.uses > 1 ? "s" : ""}
                </dd>
              </dl>
              {["logo", "character", "image"].includes(selected.kind) && (
                <div className="field">
                  <label htmlFor="asset-kind" className="label">
                    Type
                  </label>
                  <select
                    id="asset-kind"
                    className="select"
                    value={selected.kind}
                    disabled={pending}
                    onChange={(e) => change({ kind: e.target.value })}
                  >
                    <option value="logo">Logo</option>
                    <option value="character">Personnage</option>
                    <option value="image">Image</option>
                  </select>
                </div>
              )}
              {selected.kind === "character" && (
                <>
                  <div className="field">
                    <label htmlFor="asset-character" className="label">
                      Personnage
                    </label>
                    <input
                      id="asset-character"
                      key={`${selected.id}-name`}
                      className="input"
                      list="character-names"
                      defaultValue={selected.characterName ?? ""}
                      maxLength={60}
                      disabled={pending}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== selected.characterName) change({ characterName: v });
                      }}
                    />
                    <datalist id="character-names">
                      {characterNames.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                  </div>
                  <div className="field">
                    <label htmlFor="asset-pose" className="label">
                      Cette image montre
                    </label>
                    <select
                      id="asset-pose"
                      className="select"
                      value={selected.pose ?? "closed"}
                      disabled={pending}
                      onChange={(e) => change({ pose: e.target.value })}
                    >
                      {Object.entries(POSE_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="help">
                      {siblings.some((s) => s.pose === "open" || s.pose === "half")
                        ? `Ce personnage a ${siblings.length} images : sa bouche bouge quand il parle.`
                        : "Ajoute une image du même personnage bouche ouverte (même nom) pour que sa bouche bouge quand il parle. PNG détouré conseillé."}
                    </p>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="asset-rights" className="label">
                  Droits d&apos;utilisation
                </label>
                <select
                  id="asset-rights"
                  className="select"
                  value={selected.rights}
                  disabled={pending}
                  onChange={(e) => change({ rights: e.target.value })}
                >
                  {Object.entries(RIGHTS_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="help">Un fichier aux droits inconnus bloque la publication.</p>
              </div>
              <FormError message={error} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link
                  href={`/app/nouvelle-video?fichier=${selected.id}`}
                  className="btn btn-secondary btn-block"
                >
                  Utiliser dans une nouvelle vidéo
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={destroy}
                  disabled={pending}
                >
                  <Trash size={20} aria-hidden="true" />
                  Supprimer ce fichier
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Choisis un fichier pour voir son détail.</p>
          )}
        </aside>
      </div>
    </>
  );
}
