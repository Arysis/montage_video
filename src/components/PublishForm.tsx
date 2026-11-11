"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { connectAccounts, publishVideo, suggestCaption } from "@/app/actions/publish";
import { FormError, FormSuccess } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import pf from "./publish.module.css";

type Platform = "tiktok" | "instagram" | "youtube";
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram Reels" },
  { value: "youtube", label: "YouTube Shorts" },
];
const ASPECT: Record<string, string> = { "9:16": "9 / 16", "1:1": "1 / 1", "16:9": "16 / 9" };

type Props = {
  projectId: string;
  projectName: string;
  chosen: string[];
  accounts: { platform: Platform; handle: string }[];
  accountsError?: string;
  platformIssues: Record<string, string>;
  caption: string;
  hashtags: string;
  canSchedule: boolean;
  defaultDate: string;
  defaultTime: string;
  qcOpen: boolean;
  poster: string;
  video: string;
  format: string;
  sent: boolean;
  history: {
    id: string;
    when: string;
    platforms: string;
    status: string;
    failed: boolean;
    error: string | null;
  }[];
};

export function PublishForm(props: Props) {
  const { projectId, accounts, platformIssues, canSchedule, qcOpen } = props;
  const [state, action, publishing] = useActionState(publishVideo, undefined);
  const connected = (p: Platform) => accounts.find((a) => a.platform === p);
  const [platforms, setPlatforms] = useState<Platform[]>(
    PLATFORMS.map((p) => p.value).filter(
      (p) => props.chosen.includes(p) && connected(p) && !platformIssues[p],
    ),
  );
  const [caption, setCaption] = useState(props.caption);
  const [hashtags, setHashtags] = useState(props.hashtags);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [captionError, setCaptionError] = useState<string>();
  const [suggesting, startSuggest] = useTransition();
  const [connecting, startConnect] = useTransition();

  const toggle = (p: Platform) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const names = platforms.map((p) => PLATFORMS.find((x) => x.value === p)!.label).join(", ");
  const disabled = qcOpen || platforms.length === 0 || publishing;

  return (
    <>
      <TopBar eyebrow={`${props.projectName} · Étape 4 sur 4`} title="Publication" />
      <form action={action} className={styles.body}>
        <input type="hidden" name="projectId" value={projectId} />
        <div className={styles.contentNarrow}>
          <div className={styles.stack}>
            {qcOpen && (
              <p className="error-text" role="alert">
                Des points du contrôle qualité restent ouverts.{" "}
                <Link href={`/app/projets/${projectId}/montage`} className="link-underline">
                  Revenir au montage
                </Link>
              </p>
            )}
            <FormSuccess message={props.sent ? "C'est envoyé. Le suivi apparaît plus bas." : undefined} />

            <fieldset className={pf.fieldset}>
              <legend className={styles.sectionTitle}>Où publier</legend>
              {props.accountsError && <FormError message={props.accountsError} />}
              <div className={pf.list}>
                {PLATFORMS.map((p) => {
                  const account = connected(p.value);
                  const issue = platformIssues[p.value];
                  return (
                    <div key={p.value} className={`card ${pf.platform}`}>
                      <label className={pf.platformLabel}>
                        <input
                          type="checkbox"
                          name="platforms"
                          value={p.value}
                          checked={platforms.includes(p.value)}
                          disabled={!account || !!issue}
                          onChange={() => toggle(p.value)}
                        />
                        <span>
                          <span style={{ display: "block", fontWeight: 500 }}>{p.label}</span>
                          <span className="caption muted">
                            {issue
                              ? `Non compatible : ${issue}`
                              : account
                                ? `Connecté : ${account.handle}`
                                : "Pas encore connecté"}
                          </span>
                        </span>
                      </label>
                      {!account && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={connecting}
                          onClick={() => startConnect(() => connectAccounts(projectId))}
                        >
                          Connecter mon compte
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="field">
              <div className={pf.labelRow}>
                <label htmlFor="caption" className={styles.sectionTitle}>
                  Légende
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={suggesting}
                  onClick={() =>
                    startSuggest(async () => {
                      setCaptionError(undefined);
                      const res = await suggestCaption(projectId, caption);
                      if (res.error) setCaptionError(res.error);
                      if (res.caption) setCaption(res.caption);
                      if (res.hashtags) setHashtags(res.hashtags);
                    })
                  }
                >
                  {suggesting ? "L'IA réfléchit…" : "Proposer une autre légende"}
                </button>
              </div>
              <textarea
                id="caption"
                name="caption"
                className="textarea"
                rows={4}
                maxLength={2200}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <p className="help">Proposée par l&apos;IA à partir de ton script. Tu peux la modifier.</p>
              <FormError message={captionError} />
            </div>

            <div className="field">
              <label htmlFor="hashtags" className="label">
                Hashtags
              </label>
              <input
                id="hashtags"
                name="hashtags"
                className="input"
                maxLength={500}
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
              />
            </div>

            <fieldset className={pf.fieldset}>
              <legend className={styles.sectionTitle}>Quand</legend>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label className="option">
                  <input
                    type="radio"
                    name="when"
                    value="now"
                    checked={when === "now"}
                    onChange={() => setWhen("now")}
                  />
                  Maintenant
                </label>
                <label className="option" aria-disabled={!canSchedule || undefined}>
                  <input
                    type="radio"
                    name="when"
                    value="later"
                    checked={when === "later"}
                    disabled={!canSchedule}
                    onChange={() => setWhen("later")}
                  />
                  Programmer
                </label>
              </div>
              {!canSchedule && (
                <p className="help">
                  La programmation est incluse dans l&apos;offre Créateur.{" "}
                  <Link href="/tarifs" className="link-underline">
                    Voir les offres
                  </Link>
                </p>
              )}
              {when === "later" && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div className="field">
                    <label htmlFor="date" className="label">
                      Date
                    </label>
                    <input
                      id="date"
                      name="date"
                      type="date"
                      className="input"
                      defaultValue={props.defaultDate}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="time" className="label">
                      Heure (Paris)
                    </label>
                    <input
                      id="time"
                      name="time"
                      type="time"
                      className="input"
                      defaultValue={props.defaultTime}
                      required
                    />
                  </div>
                </div>
              )}
            </fieldset>

            {props.history.length > 0 && (
              <section className={styles.section} aria-labelledby="history-title">
                <h2 id="history-title" className={styles.sectionTitle}>
                  Suivi
                </h2>
                <ul className={pf.list}>
                  {props.history.map((h) => (
                    <li key={h.id} className={`card ${pf.platform}`}>
                      <span>
                        <span style={{ display: "block", fontWeight: 500 }}>{h.platforms}</span>
                        <span className="caption muted">
                          {h.when}
                          {h.failed && h.error ? ` · ${h.error}` : ""}
                        </span>
                      </span>
                      <span
                        className={`badge ${h.failed ? "" : "badge-success"}`}
                        style={h.failed ? { color: "var(--color-danger)" } : undefined}
                      >
                        {h.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <aside className={styles.panel}>
          <h2>Aperçu</h2>
          <div className={pf.preview} style={{ aspectRatio: ASPECT[props.format] ?? "9 / 16" }}>
            <video src={props.video} poster={props.poster} controls preload="none" playsInline />
            {caption && (
              <p className={pf.previewCaption}>
                {caption.length > 90 ? `${caption.slice(0, 90)}…` : caption}
              </p>
            )}
          </div>
          <p className="muted">
            {platforms.length === 0
              ? "Choisis au moins une plateforme reliée."
              : when === "later"
                ? `Programmée sur ${names}.`
                : `Publiée tout de suite sur ${names}.`}
          </p>
          <FormError message={state?.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={disabled}>
            {publishing ? "Envoi…" : when === "later" ? "Programmer la publication" : "Publier maintenant"}
          </button>
        </aside>
      </form>
    </>
  );
}
