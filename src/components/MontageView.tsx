"use client";

import {
  CheckCircle,
  Info,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { acknowledgeWarning, correctMontage, redoPart } from "@/app/actions/projects";
import type { QcCheck, QcReport } from "@/lib/qc/types";
import { FormError, FormSuccess } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import m from "./montage.module.css";

type Status = {
  renderStatus: "idle" | "queued" | "running" | "done" | "failed";
  renderProgress: number;
  renderMessage: string | null;
};
type Timeline = {
  duration: number;
  scenes: { id: string; label: string; text: string; start: number; end: number }[];
  cues: { start: number; end: number; text: string }[];
  voiceLabel: string;
  music: string | null;
};
type Props = {
  projectId: string;
  projectName: string;
  title: string;
  status: Status;
  video: { src: string; poster: string; download: string } | null;
  format: string;
  timeline: Timeline | null;
  report: QcReport | null;
  acknowledged: string[];
};

const fmt = (t: number) => {
  const s = Math.max(0, t);
  const cs = Math.floor((s % 1) * 100);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
const ASPECT: Record<string, string> = { "9:16": "9 / 16", "1:1": "1 / 1", "16:9": "16 / 9" };

function CheckIcon({ check, kept }: { check: QcCheck; kept: boolean }) {
  if (check.status === "pass" || kept) return <CheckCircle size={20} className={m.ok} aria-hidden="true" />;
  if (check.status === "fail") return <WarningCircle size={20} className={m.bad} aria-hidden="true" />;
  if (check.status === "warn") return <Warning size={20} className={m.bad} aria-hidden="true" />;
  return <Info size={20} className="subtle" aria-hidden="true" />;
}

export function MontageView(props: Props) {
  const { projectId, projectName, title, status, video, format, timeline, report, acknowledged } = props;
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState<Status>(status);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string>();
  const [correction, correctAction, correcting] = useActionState(correctMontage, undefined);

  useEffect(() => setLive(status), [status]);

  // Suivi du montage en cours.
  const working = live.renderStatus === "queued" || live.renderStatus === "running";
  useEffect(() => {
    if (!working) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/status`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (stopped) return;
          setLive(next);
          if (next.renderStatus === "done" || next.renderStatus === "failed") {
            router.refresh();
            return;
          }
        }
      } catch {
        /* nouvelle tentative au prochain tour */
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    let timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [working, projectId, router]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, (timeline?.duration ?? v.duration) - 0.05));
    setTime(v.currentTime);
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const scenes = timeline?.scenes ?? [];
  const currentScene = scenes.findIndex((s) => time >= s.start && time < s.end);
  const jump = (dir: -1 | 1) => {
    if (!scenes.length) return;
    const idx = currentScene < 0 ? 0 : currentScene;
    const target = scenes[Math.max(0, Math.min(scenes.length - 1, idx + dir))]!;
    seek(dir === -1 && time - (scenes[idx]?.start ?? 0) > 1 ? scenes[idx]!.start : target.start);
  };

  const checks = report?.checks ?? [];
  const visibleChecks = checks.filter((c) => c.status !== "skipped");
  const skipped = checks.filter((c) => c.status === "skipped");
  const open = checks.filter(
    (c) => c.status === "fail" || (c.status === "warn" && !acknowledged.includes(c.key)),
  );
  const fails = checks.filter((c) => c.status === "fail");
  const canPublish = !!video && !!report && open.length === 0 && !working;
  const ordered = [...visibleChecks].sort((a, b) => {
    const rank = (c: QcCheck) =>
      c.status === "fail" ? 0 : c.status === "warn" && !acknowledged.includes(c.key) ? 1 : 2;
    return rank(a) - rank(b);
  });

  const redo = (check: QcCheck) => {
    if (!check.sceneId) return;
    setActionError(undefined);
    startTransition(async () => {
      const res = await redoPart(
        projectId,
        check.sceneId!,
        `Corrige ce point : ${check.title}. ${check.detail ?? ""}`,
      );
      if (res?.error) setActionError(res.error);
      else setLive({ renderStatus: "queued", renderProgress: 0, renderMessage: "En attente" });
    });
  };
  const keep = (check: QcCheck) => startTransition(() => acknowledgeWarning(projectId, check.key));

  const summary = !report
    ? null
    : open.length === 0
      ? `L'IA a vérifié ${visibleChecks.length} points. Tout est bon.`
      : `L'IA a vérifié ${visibleChecks.length} points. ${open.length === 1 ? "Un point reste" : `${open.length} points restent`} à revoir.`;

  return (
    <>
      <TopBar
        eyebrow={`${projectName} · Étape 3 sur 4`}
        title={title}
        actions={
          <>
            {video && !working && (
              <a href={video.download} className="btn btn-secondary">
                Télécharger le MP4
              </a>
            )}
            {canPublish ? (
              <Link href={`/app/projets/${projectId}/publication`} className="btn btn-primary">
                Passer à la publication
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled
                title="Règle d'abord les points du contrôle qualité."
              >
                Passer à la publication
              </button>
            )}
          </>
        }
      />
      <div className={styles.body}>
        <div className={m.main}>
          <div className={m.viewer}>
            {working ? (
              <div className={m.working} role="status" aria-live="polite">
                <p className="h3">L&apos;IA monte ta vidéo</p>
                <p className="muted">{live.renderMessage ?? "En attente"}</p>
                <div className="progress progress-primary" style={{ width: 280 }}>
                  <span style={{ width: `${Math.max(4, live.renderProgress)}%` }} />
                </div>
                <p className="caption subtle">Tu peux quitter cette page. Le montage continue.</p>
              </div>
            ) : live.renderStatus === "failed" && !video ? (
              <div className={m.working} role="alert">
                <p className="h3">Le montage n&apos;a pas abouti</p>
                <p className="muted">{live.renderMessage ?? "Relance-le depuis le prompteur."}</p>
                <Link href={`/app/projets/${projectId}/prompteur`} className="btn btn-secondary">
                  Retour au prompteur
                </Link>
              </div>
            ) : video ? (
              <>
                <div className={m.frame} style={{ aspectRatio: ASPECT[format] ?? "9 / 16" }}>
                  <video
                    ref={videoRef}
                    src={video.src}
                    poster={video.poster}
                    preload="metadata"
                    playsInline
                    onClick={toggle}
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                </div>
                <div className={m.controls}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => jump(-1)}
                    aria-label="Plan précédent"
                  >
                    <SkipBack size={20} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={toggle}
                    aria-label={playing ? "Pause" : "Lecture"}
                  >
                    {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => jump(1)}
                    aria-label="Plan suivant"
                  >
                    <SkipForward size={20} aria-hidden="true" />
                  </button>
                  <span className="caption muted tabular">
                    {fmt(time)} / {fmt(timeline?.duration ?? 0)}
                  </span>
                </div>
              </>
            ) : (
              <div className={m.working}>
                <p className="muted">Pas encore de montage.</p>
              </div>
            )}
          </div>

          {timeline && (
            <TimelineTracks
              timeline={timeline}
              time={time}
              current={currentScene}
              onSeek={seek}
              disabled={!video || working}
            />
          )}
        </div>

        <aside className={styles.panel} aria-labelledby="qc-title">
          <div>
            <h2 id="qc-title">Contrôle qualité</h2>
            {summary && <p className="muted">{summary}</p>}
            {!report && !working && <p className="muted">Le contrôle se lance à la fin du montage.</p>}
            {working && <p className="muted">Le contrôle se lance à la fin du montage.</p>}
          </div>
          {fails.length > 0 && !working && (
            <p className="error-text">La publication est bloquée tant qu&apos;un point rouge reste ouvert.</p>
          )}
          <ul className={m.checks}>
            {ordered.map((c) => {
              const kept = c.status === "warn" && acknowledged.includes(c.key);
              const needs = c.status === "fail" || (c.status === "warn" && !kept);
              return (
                <li key={c.key} className={`card ${m.check}`} data-open={needs || undefined}>
                  <CheckIcon check={c} kept={kept} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500 }}>{c.title}</p>
                    <p className="caption muted">
                      {c.status === "pass"
                        ? "Validé"
                        : kept
                          ? "Gardé tel quel"
                          : (c.detail ?? (c.status === "fail" ? "À corriger" : "À revoir"))}
                    </p>
                    {needs && !working && (
                      <div className={m.checkActions}>
                        {c.sceneId && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={pending}
                            onClick={() => redo(c)}
                          >
                            Refaire cette partie
                          </button>
                        )}
                        {c.status === "warn" && (
                          <button
                            type="button"
                            className="btn btn-sm link"
                            disabled={pending}
                            onClick={() => keep(c)}
                          >
                            Garder tel quel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {skipped.length > 0 && (
            <p className="caption subtle">
              Non vérifié sur ce serveur : {skipped.map((c) => c.title).join(", ")}.
            </p>
          )}
          <FormError message={actionError} />

          {video && !working && (
            <form action={correctAction} className="field">
              <input type="hidden" name="projectId" value={projectId} />
              <label htmlFor="instruction" className="label">
                Demander une correction
              </label>
              <textarea
                id="instruction"
                name="instruction"
                className="textarea"
                rows={3}
                maxLength={500}
                placeholder="Exemple : mets la photo du produit au début et baisse la musique."
              />
              <FormError message={correction?.error} />
              <FormSuccess message={correction?.ok} />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={correcting}
                style={{ alignSelf: "flex-start" }}
              >
                {correcting ? "Envoi…" : "Refaire le montage"}
              </button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

function TimelineTracks({
  timeline,
  time,
  current,
  onSeek,
  disabled,
}: {
  timeline: Timeline;
  time: number;
  current: number;
  onSeek: (t: number) => void;
  disabled: boolean;
}) {
  const d = timeline.duration || 1;
  const pct = (t: number) => `${(Math.max(0, Math.min(t, d)) / d) * 100}%`;
  const step = d > 60 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(d / step) + 1 }, (_, i) => i * step);
  const trackRef = useRef<HTMLDivElement>(null);
  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    onSeek(((e.clientX - rect.left) / rect.width) * d);
  };
  return (
    <div className={m.timeline} aria-label="Plan de montage">
      <div className={m.row}>
        <span />
        <div className={m.ticks}>
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }} className="caption subtle tabular">
              {`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`}
            </span>
          ))}
        </div>
      </div>
      <div className={m.tracks}>
        <div className={m.row}>
          <span className="caption muted">Plans</span>
          <div className={m.track} ref={trackRef} onClick={seekFromEvent}>
            {timeline.scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={m.block}
                data-current={i === current || undefined}
                style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 4px)` }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) onSeek(s.start + 0.01);
                }}
                title={s.text}
              >
                {s.label} · {s.text}
              </button>
            ))}
            <span className={m.playhead} style={{ left: pct(time) }} aria-hidden="true" />
          </div>
        </div>
        <div className={m.row}>
          <span className="caption muted">Voix</span>
          <div className={m.track} onClick={seekFromEvent}>
            <span className={m.lane} style={{ left: 0, width: "100%" }}>
              {timeline.voiceLabel}
            </span>
            <span className={m.playhead} style={{ left: pct(time) }} aria-hidden="true" />
          </div>
        </div>
        <div className={m.row}>
          <span className="caption muted">Sous-titres</span>
          <div className={m.track} onClick={seekFromEvent}>
            {timeline.cues.map((c, i) => (
              <span
                key={i}
                className={m.cue}
                style={{ left: pct(c.start), width: `calc(${pct(c.end - c.start)} - 2px)` }}
                title={c.text}
              />
            ))}
            <span className={m.playhead} style={{ left: pct(time) }} aria-hidden="true" />
          </div>
        </div>
        <div className={m.row}>
          <span className="caption muted">Musique</span>
          <div className={m.track} onClick={seekFromEvent}>
            {timeline.music ? (
              <span className={m.lane} style={{ left: 0, width: "100%" }}>
                {timeline.music}
              </span>
            ) : (
              <span className="caption subtle" style={{ padding: "6px 8px" }}>
                Sans musique
              </span>
            )}
            <span className={m.playhead} style={{ left: pct(time) }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
