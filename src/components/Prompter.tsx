"use client";

import { Check, Microphone, Pause, Play, Record, Stop, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { deleteTake, selectTake, startMontage } from "@/app/actions/projects";
import { FormError } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import p from "./prompter.module.css";
import { uploadFile } from "./useUpload";

type Take = {
  id: string;
  number: number;
  durationSec: number;
  stoppedAtLine: number | null;
  complete: boolean;
  storageKey: string;
};
type Props = {
  projectId: string;
  projectName: string;
  lines: string[];
  takes: Take[];
  selectedTakeId: string | null;
  montageStarted: boolean;
};

const SPEEDS = [
  { label: "Très lente", wps: 1.9 },
  { label: "Lente", wps: 2.3 },
  { label: "Moyenne", wps: 2.6 },
  { label: "Rapide", wps: 3 },
  { label: "Très rapide", wps: 3.4 },
];
const SETTINGS_KEY = "prompteur-reglages";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

export function Prompter({ projectId, projectName, lines, takes, selectedTakeId, montageStarted }: Props) {
  const router = useRouter();
  const [speed, setSpeed] = useState(2);
  const [size, setSize] = useState(37);
  const [countdown, setCountdown] = useState(3);
  const [mirror, setMirror] = useState(false);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"idle" | "countdown" | "recording" | "uploading">("idle");
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [micName, setMicName] = useState<string>("Micro non activé");
  const [level, setLevel] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef(0);
  currentRef.current = current;

  // Réglages mémorisés sur cet appareil.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      if (typeof saved.speed === "number") setSpeed(Math.min(4, Math.max(0, saved.speed)));
      if (typeof saved.size === "number") setSize(Math.min(64, Math.max(24, saved.size)));
      if (typeof saved.countdown === "number") setCountdown(saved.countdown);
      if (typeof saved.mirror === "boolean") setMirror(saved.mirror);
    } catch {
      /* stockage indisponible */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ speed, size, countdown, mirror }));
    } catch {
      /* stockage indisponible */
    }
  }, [speed, size, countdown, mirror]);

  // La ligne en cours reste au centre.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lineRefs.current[current]?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopStream, [stopStream]);

  /** Active le micro et le vu-mètre. */
  const openMic = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Ton navigateur ne permet pas d'enregistrer. Essaie Chrome, Edge, Firefox ou Safari récent.");
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setMicName(stream.getAudioTracks()[0]?.label || "Micro");
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!streamRef.current) {
          void ctx.close();
          return;
        }
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        requestAnimationFrame(tick);
      };
      tick();
      return stream;
    } catch {
      setError("Accès au micro refusé. Autorise le micro dans ton navigateur puis réessaie.");
      return null;
    }
  }, []);

  const beginRecording = useCallback(
    (stream: MediaStream) => {
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const type = (rec.mimeType || mime || "audio/webm").split(";")[0]!;
        const blob = new Blob(chunksRef.current, { type });
        const reached = currentRef.current;
        const complete = reached >= lines.length - 1;
        setPhase("uploading");
        setProgress(0);
        try {
          const params = new URLSearchParams({ ligne: String(reached + 1) });
          if (complete) params.set("complete", "1");
          await uploadFile(`/api/projects/${projectId}/takes?${params}`, blob, type, setProgress);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Envoi impossible.");
        } finally {
          setPhase("idle");
        }
      };
      rec.start(1000);
      recorderRef.current = rec;
      setElapsed(0);
      setCurrent(0);
      setPhase("recording");
    },
    [lines.length, projectId, router],
  );

  const start = async () => {
    setError(undefined);
    const stream = await openMic();
    if (!stream) return;
    if (countdown > 0) {
      setCount(countdown);
      setPhase("countdown");
    } else beginRecording(stream);
  };
  const stop = () => {
    if (phase === "countdown") {
      setPhase("idle");
      return;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  // Compte à rebours.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      if (streamRef.current) beginRecording(streamRef.current);
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count, beginRecording]);

  // Défilement automatique : chaque ligne reste le temps de la lire à la vitesse choisie.
  useEffect(() => {
    if (phase !== "recording") return;
    let lineStart = performance.now();
    let lineIndex = currentRef.current;
    const started = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setElapsed((now - started) / 1000);
      if (currentRef.current !== lineIndex) {
        lineIndex = currentRef.current;
        lineStart = now;
      }
      const need = (Math.max(2, words(lines[lineIndex] ?? "")) / SPEEDS[speed]!.wps) * 1000 + 250;
      if (now - lineStart > need && lineIndex < lines.length - 1) {
        lineIndex += 1;
        lineStart = now;
        setCurrent(lineIndex);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [phase, speed, lines]);

  // Raccourcis clavier : flèches pour changer de ligne, Échap pour arrêter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowDown") setCurrent((c) => Math.min(lines.length - 1, c + 1));
      if (e.key === "ArrowUp") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "Escape" && (phase === "recording" || phase === "countdown")) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const remaining = lines.slice(current).reduce((sum, l) => sum + words(l) / SPEEDS[speed]!.wps, 0);
  const selected = takes.find((t) => t.id === selectedTakeId);

  const listen = (take: Take) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === take.id) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.src = `/api/files/${take.storageKey}`;
    void audio.play();
    setPlaying(take.id);
  };

  const goMontage = () => {
    setError(undefined);
    startTransition(async () => {
      const res = await startMontage(projectId);
      if (res?.error) setError(res.error);
    });
  };

  const busy = phase !== "idle";
  const dots = 16;

  return (
    <>
      <TopBar
        eyebrow={`${projectName} · Étape 3 sur 5`}
        title="Prompteur"
        actions={
          <Link
            href={`/app/projets/${projectId}/script`}
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
          >
            Modifier le script
          </Link>
        }
      />
      <div className={styles.body}>
        <div className={p.stage}>
          <div
            className={p.textArea}
            style={{ transform: mirror ? "scaleX(-1)" : undefined }}
            aria-live="off"
          >
            <div className={p.spacer} />
            {lines.map((line, i) => (
              <p
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className={p.line}
                data-current={i === current || undefined}
                data-done={i < current || undefined}
                style={{ fontSize: size, lineHeight: `${Math.round(size * 1.3)}px` }}
                onClick={() => setCurrent(i)}
              >
                {line}
              </p>
            ))}
            <div className={p.spacer} />
          </div>
          {phase === "countdown" && (
            <div className={p.countdown} role="status" aria-live="assertive">
              {count}
            </div>
          )}
          <div className={p.footer}>
            <div className={p.mic}>
              <Microphone size={20} aria-hidden="true" />
              <span className={p.meter} aria-hidden="true">
                {Array.from({ length: dots }, (_, i) => (
                  <span key={i} data-on={level * dots * 1.6 > i || undefined} />
                ))}
              </span>
              <span
                className="caption subtle"
                style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {micName}
              </span>
            </div>
            {phase === "recording" || phase === "countdown" ? (
              <button type="button" className="btn btn-primary btn-site" onClick={stop}>
                <Stop size={20} weight="fill" aria-hidden="true" />
                Arrêter · {mmss(elapsed)}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-site"
                onClick={start}
                disabled={phase === "uploading"}
              >
                <Record size={20} weight="fill" aria-hidden="true" />
                {phase === "uploading"
                  ? `Envoi de la prise… ${Math.round(progress * 100)} %`
                  : "Lancer l'enregistrement"}
              </button>
            )}
            <span className="caption subtle tabular">
              Ligne {current + 1} sur {lines.length} · reste environ {mmss(remaining)}
            </span>
          </div>
        </div>

        <aside className={styles.panel}>
          <h2>Réglages</h2>
          <div className="field">
            <div className={p.rangeLabel}>
              <label htmlFor="speed" className="label">
                Vitesse de défilement
              </label>
              <span className="muted">{SPEEDS[speed]!.label}</span>
            </div>
            <input
              id="speed"
              type="range"
              min={0}
              max={4}
              step={1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <div className={p.rangeLabel}>
              <label htmlFor="size" className="label">
                Taille du texte
              </label>
              <span className="muted tabular">{size}px</span>
            </div>
            <input
              id="size"
              type="range"
              min={24}
              max={64}
              step={1}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="countdown" className="label">
              Compte à rebours
            </label>
            <select
              id="countdown"
              className="select"
              value={countdown}
              onChange={(e) => setCountdown(Number(e.target.value))}
            >
              <option value={0}>Aucun</option>
              <option value={3}>3 secondes</option>
              <option value={5}>5 secondes</option>
            </select>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            Mode miroir (pour une vitre de prompteur)
          </label>

          <section className={p.takes} aria-labelledby="takes-title">
            <h2 id="takes-title">Tes prises</h2>
            {takes.length === 0 ? (
              <p className="muted">
                Pas encore de prise. Lis le texte à voix haute, l&apos;IA cale le montage sur ta voix.
              </p>
            ) : (
              <ul className={p.takeList}>
                {takes.map((t) => (
                  <li key={t.id} className={`card ${p.take}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 500 }}>Prise {t.number}</p>
                      <p className="caption subtle tabular">
                        {mmss(t.durationSec)} ·{" "}
                        {t.complete ? "complète" : `arrêtée ligne ${t.stoppedAtLine ?? "?"}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => listen(t)}
                      aria-label={
                        playing === t.id ? `Arrêter la prise ${t.number}` : `Réécouter la prise ${t.number}`
                      }
                    >
                      {playing === t.id ? (
                        <Pause size={16} aria-hidden="true" />
                      ) : (
                        <Play size={16} aria-hidden="true" />
                      )}
                      <span className={p.hideSmall}>Réécouter</span>
                    </button>
                    {t.id === selectedTakeId ? (
                      <span className="badge badge-success">
                        <Check size={12} aria-hidden="true" />
                        Retenue
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={pending}
                          onClick={() => startTransition(() => selectTake(projectId, t.id))}
                        >
                          Retenir
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={pending}
                          aria-label={`Supprimer la prise ${t.number}`}
                          onClick={() => {
                            if (window.confirm(`Supprimer la prise ${t.number} ?`))
                              startTransition(() => deleteTake(projectId, t.id));
                          }}
                        >
                          <Trash size={16} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <audio ref={audioRef} onEnded={() => setPlaying(null)} hidden />
            <FormError message={error} />
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={!selected || busy || pending}
              onClick={goMontage}
            >
              {pending
                ? "Lancement…"
                : montageStarted
                  ? "Refaire le montage avec cette prise"
                  : "Passer au montage"}
            </button>
            {!selected && takes.length > 0 && (
              <p className="help">Retiens une prise pour passer au montage.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
