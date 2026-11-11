"use client";

import { Play } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import styles from "./home.module.css";

/** Vidéo de présentation. Tant qu'elle n'est pas tournée, on affiche le cadre prévu par le DESIGN.md. */
export function DemoVideo({ src, poster }: { src?: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce)
      v.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  if (!src) {
    return (
      <div
        className={styles.demoFrame}
        role="img"
        aria-label="Emplacement de la vidéo de démonstration, pas encore tournée"
      >
        <div className={styles.demoLeft}>
          <span className={styles.skeleton} style={{ width: "50%" }} />
          <span className={styles.skeleton} style={{ width: "75%" }} />
          <span className={styles.skeleton} style={{ width: "40%" }} />
          <p className="ui muted" style={{ marginTop: 16 }}>
            [Vidéo de démo à tourner]
          </p>
          <p className="caption subtle">
            Plan large de l&apos;app. La vidéo verticale se construit à droite.
          </p>
        </div>
        <div className={styles.demoPhone} />
      </div>
    );
  }

  return (
    <div>
      <div className={styles.demoFrame} style={{ padding: 0, overflow: "hidden" }}>
        <video
          ref={ref}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Démonstration : une idée devient une vidéo prête à publier"
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {!playing && (
          <button
            type="button"
            className={`btn btn-primary ${styles.playBtn}`}
            onClick={() => ref.current?.play()}
          >
            <Play size={20} weight="regular" aria-hidden="true" />
            Lire
          </button>
        )}
      </div>
      <p className="caption subtle tabular" style={{ textAlign: "center", marginTop: 8 }}>
        {fmt(time)} / {fmt(duration)}
      </p>
    </div>
  );
}
