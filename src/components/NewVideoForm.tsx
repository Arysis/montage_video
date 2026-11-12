"use client";

import { UploadSimple, X } from "@phosphor-icons/react";
import { useActionState, useCallback, useRef, useState } from "react";
import { createProject } from "@/app/actions/projects";
import { FormError } from "./FormMessage";
import styles from "./app.module.css";
import f from "./forms.module.css";
import { type UploadedAsset, useUpload } from "./useUpload";

const FORMATS = [
  { value: "9:16", label: "Vertical", w: 18, h: 32 },
  { value: "1:1", label: "Carré", w: 28, h: 28 },
  { value: "16:9", label: "Horizontal", w: 36, h: 20 },
] as const;
const PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram Reels" },
  { value: "youtube", label: "YouTube Shorts" },
] as const;
const DURATIONS = [15, 30, 45, 60, 90];

type Props = {
  library: UploadedAsset[];
  maxDurationSec: number;
  brandKitApplied: boolean;
  preselected?: UploadedAsset[];
  /** Le projet a déjà un script : le régénérer remplace l'ancien. */
  regenerate?: boolean;
  initial?: {
    projectId: string;
    idea: string;
    format: string;
    platforms: string[];
    duration: number;
    assets: UploadedAsset[];
  };
};

export function NewVideoForm({
  library,
  maxDurationSec,
  brandKitApplied,
  preselected,
  regenerate,
  initial,
}: Props) {
  const [state, action, pending] = useActionState(createProject, undefined);
  const [format, setFormat] = useState(initial?.format ?? "9:16");
  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? ["tiktok", "instagram"]);
  const [duration, setDuration] = useState(initial?.duration ?? 30);
  const [selected, setSelected] = useState<UploadedAsset[]>(initial?.assets ?? preselected ?? []);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const onDone = useCallback((a: UploadedAsset) => setSelected((prev) => [...prev, a]), []);
  const { items, upload, remove } = useUpload(onDone);
  const uploading = items.some((i) => !i.asset && !i.error);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const formatLabel = FORMATS.find((x) => x.value === format);

  return (
    <form id="new-video" action={action} className={styles.body}>
      {initial && <input type="hidden" name="projectId" value={initial.projectId} />}
      {selected.map((a) => (
        <input key={a.id} type="hidden" name="assetIds" value={a.id} />
      ))}
      <div className={styles.contentNarrow}>
        <div className={styles.stack}>
          <div className="field">
            <label htmlFor="idea" className="h2" style={{ fontSize: 25, lineHeight: "30px" }}>
              Écris ton idée
            </label>
            <textarea
              id="idea"
              name="idea"
              className="textarea"
              rows={6}
              required
              minLength={10}
              maxLength={4000}
              defaultValue={initial?.idea}
              placeholder="Exemple : trois erreurs à éviter quand on débute sur TikTok. Ton direct, un peu drôle."
              aria-describedby="idea-help"
            />
            <p id="idea-help" className="help">
              Dis le sujet, le ton et à qui tu parles. L&apos;IA écrit le script à partir de ça.
            </p>
          </div>

          <fieldset className={f.fieldset}>
            <legend className="label">Format</legend>
            <div className={f.formatGrid}>
              {FORMATS.map((x) => (
                <label key={x.value} className={`option ${f.formatCard}`}>
                  <input
                    type="radio"
                    name="format"
                    value={x.value}
                    checked={format === x.value}
                    onChange={() => setFormat(x.value)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    style={{ width: x.w, height: x.h, border: "1.5px solid currentColor", borderRadius: 3 }}
                  />
                  <span style={{ fontWeight: 500 }}>{x.label}</span>
                  <span className="caption subtle">{x.value}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={f.fieldset}>
            <legend className="label">Plateformes</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PLATFORMS.map((p) => (
                <label key={p.value} className="option">
                  <input
                    type="checkbox"
                    name="platforms"
                    value={p.value}
                    checked={platforms.includes(p.value)}
                    onChange={() => togglePlatform(p.value)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="duration" className="label">
              Durée visée
            </label>
            <select
              id="duration"
              name="duration"
              className="select"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {DURATIONS.filter((d) => d <= maxDurationSec).map((d) => (
                <option key={d} value={d}>
                  {d} s
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">Tes fichiers</span>
            <div
              className={f.dropzone}
              data-dragging={dragging || undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files);
              }}
            >
              <UploadSimple size={20} aria-hidden="true" />
              <p className="muted ui" style={{ fontWeight: 400 }}>
                Glisse tes images, vidéos, musiques ou logos ici.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => fileInput.current?.click()}
                >
                  Importer mes fichiers
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => dialog.current?.showModal()}
                >
                  Choisir dans ma bibliothèque
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.ogg,.ttf,.otf"
                onChange={(e) => e.target.files && void upload(e.target.files)}
              />
            </div>
            <ul className={f.chips} aria-label="Fichiers ajoutés">
              {selected.map((a) => (
                <li key={a.id} className={f.chip}>
                  {a.name}
                  <button
                    type="button"
                    aria-label={`Retirer ${a.name}`}
                    onClick={() => setSelected((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
              {items
                .filter((i) => !i.asset)
                .map((i) => (
                  <li key={i.key} className={f.chip} data-error={i.error ? true : undefined}>
                    {i.name} {i.error ? `· ${i.error}` : `· ${Math.round(i.progress * 100)} %`}
                    {i.error && (
                      <button type="button" aria-label="Fermer" onClick={() => remove(i.key)}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>

      <aside className={styles.panel}>
        <h2>Récapitulatif</h2>
        <dl className={f.summary}>
          <dt>Format</dt>
          <dd>
            {formatLabel?.label} ({format})
          </dd>
          <dt>Plateformes</dt>
          <dd>{platforms.map((p) => PLATFORMS.find((x) => x.value === p)?.label).join(", ") || "Aucune"}</dd>
          <dt>Durée</dt>
          <dd>{duration} s</dd>
          <dt>Fichiers</dt>
          <dd>
            {selected.length} fichier{selected.length > 1 ? "s" : ""}
          </dd>
          <dt>Brand Kit</dt>
          <dd>
            {brandKitApplied ? "Appliqué" : "Par défaut"} ·{" "}
            <a href="/app/brand-kit" className="link-underline">
              modifier
            </a>
          </dd>
        </dl>
        <p className="card muted" style={{ padding: 12, background: "transparent" }}>
          {regenerate
            ? "Un nouveau script remplacera l'actuel. Tes prises restent disponibles."
            : "Ensuite, tu relis le script. Puis tu l'enregistres au prompteur."}
        </p>
        <FormError message={state?.error} />
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={pending || uploading || platforms.length === 0}
        >
          {pending ? "L'IA écrit ton script…" : regenerate ? "Réécrire le script" : "Générer le script"}
        </button>
        {pending && (
          <div
            className="progress progress-primary"
            role="progressbar"
            aria-label="Écriture du script en cours"
          >
            <span style={{ width: "60%" }} />
          </div>
        )}
      </aside>

      <dialog ref={dialog} aria-labelledby="library-title">
        <h2 id="library-title" className="h3" style={{ marginBottom: 16 }}>
          Ta bibliothèque
        </h2>
        {library.length === 0 ? (
          <p className="muted">Ta bibliothèque est vide. Importe des fichiers d&apos;abord.</p>
        ) : (
          <ul className={f.libraryList}>
            {library.map((a) => {
              const on = selected.some((s) => s.id === a.id);
              return (
                <li key={a.id}>
                  <label className="option">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((prev) => (on ? prev.filter((x) => x.id !== a.id) : [...prev, a]))
                      }
                    />
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <span className="caption subtle">{a.kind}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>
            Valider ma sélection
          </button>
        </div>
      </dialog>
    </form>
  );
}
