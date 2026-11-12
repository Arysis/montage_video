"use client";

import { ArrowDown, ArrowUp, Plus, Trash, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveScriptDraft, validateScript } from "@/app/actions/projects";
import {
  BACKGROUND_LABELS,
  BACKGROUND_STYLES,
  EFFECT_LABELS,
  EFFECTS,
  estimateSpeechSeconds,
  PACE_LABELS,
  PACES,
  type SceneScript,
  type Script,
  TRANSITION_LABELS,
  TRANSITIONS,
} from "@/lib/script/schema";
import { FormError, FormSuccess } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import f from "./forms.module.css";
import s from "./script.module.css";

type FileOption = { id: string; name: string; kind: string };
type Props = {
  projectId: string;
  projectName: string;
  script: Script;
  files: FileOption[];
  targetDurationSec: number;
  hasTakes: boolean;
};

const KIND_LABELS: Record<string, string> = {
  video: "vidéo",
  image: "image",
  character: "personnage",
  music: "musique",
};

const mmss = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

export function ScriptEditor({
  projectId,
  projectName,
  script: initial,
  files,
  targetDurationSec,
  hasTakes,
}: Props) {
  const [script, setScript] = useState<Script>(initial);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, startTransition] = useTransition();
  const visuals = files.filter((x) => x.kind === "video" || x.kind === "image");
  const characters = files.filter((x) => x.kind === "character");
  const music = files.filter((x) => x.kind === "music");
  const nameOf = (id: string) => files.find((x) => x.id === id)?.name ?? "Fichier";
  const total = script.scenes.reduce((n, sc) => n + estimateSpeechSeconds(sc.text), 0);
  const textChanged =
    script.scenes.map((x) => x.text).join("|") !== initial.scenes.map((x) => x.text).join("|");

  const update = (patch: Partial<Script>) => {
    setMsg({});
    setScript((prev) => ({ ...prev, ...patch }));
  };
  const updateScene = (i: number, patch: Partial<SceneScript>) => {
    setMsg({});
    setScript((prev) => ({
      ...prev,
      scenes: prev.scenes.map((sc, k) => (k === i ? { ...sc, ...patch } : sc)),
    }));
  };
  const moveScene = (i: number, dir: -1 | 1) => {
    setScript((prev) => {
      const scenes = [...prev.scenes];
      const [item] = scenes.splice(i, 1);
      scenes.splice(i + dir, 0, item!);
      return { ...prev, scenes: scenes.map((sc, k) => ({ ...sc, id: `s${k + 1}` })) };
    });
  };
  const removeScene = (i: number) =>
    setScript((prev) => ({
      ...prev,
      scenes: prev.scenes.filter((_, k) => k !== i).map((sc, k) => ({ ...sc, id: `s${k + 1}` })),
    }));
  const addScene = () =>
    setScript((prev) => ({
      ...prev,
      scenes: [
        ...prev.scenes,
        {
          id: `s${prev.scenes.length + 1}`,
          text: "",
          visualIntent: "Plan qui illustre la phrase",
          onScreenText: null,
          visuals: [],
          background: "aurore",
          effects: ["zoom-in"],
          transition: "cut",
          character: null,
          emphasis: [],
        },
      ],
    }));

  const save = (validate: boolean) => {
    const json = JSON.stringify(script);
    startTransition(async () => {
      const res = validate ? await validateScript(projectId, json) : await saveScriptDraft(projectId, json);
      setMsg(res ?? {});
    });
  };

  return (
    <>
      <TopBar
        eyebrow={`${projectName} · Étape 2 sur 5`}
        title="Script"
        actions={
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => save(false)}>
            Enregistrer
          </button>
        }
      />
      <div className={styles.body}>
        <div className={styles.content}>
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <p className="muted">
              Voici tout ce que l&apos;IA a prévu, scène par scène : ce que tu dis, ce qu&apos;on voit, les
              effets et les transitions. Change ce que tu veux, puis valide : le prompteur reprendra ce texte
              et le montage suivra ces choix.
            </p>
            <ol className={s.scenes} aria-label="Scènes du script">
              {script.scenes.map((sc, i) => {
                const id = `sc${i}`;
                const available = visuals.filter((v) => !sc.visuals.includes(v.id));
                return (
                  <li key={i} className={`card ${s.scene}`}>
                    <div className={s.sceneHead}>
                      <h2>
                        Scène {i + 1}{" "}
                        <span className="caption subtle tabular">≈ {estimateSpeechSeconds(sc.text)} s</span>
                      </h2>
                      <div className={s.inline}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={i === 0}
                          onClick={() => moveScene(i, -1)}
                          aria-label={`Monter la scène ${i + 1}`}
                        >
                          <ArrowUp size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={i === script.scenes.length - 1}
                          onClick={() => moveScene(i, 1)}
                          aria-label={`Descendre la scène ${i + 1}`}
                        >
                          <ArrowDown size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={script.scenes.length === 1}
                          onClick={() => removeScene(i)}
                          aria-label={`Supprimer la scène ${i + 1}`}
                        >
                          <Trash size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor={`${id}-text`} className="label">
                        Ce que tu dis
                      </label>
                      <textarea
                        id={`${id}-text`}
                        className="textarea"
                        rows={3}
                        maxLength={600}
                        value={sc.text}
                        onChange={(e) => updateScene(i, { text: e.target.value })}
                      />
                    </div>

                    <div className={s.grid}>
                      <div className="field">
                        <label htmlFor={`${id}-intent`} className="label">
                          Ce qu&apos;on voit
                        </label>
                        <input
                          id={`${id}-intent`}
                          className="input"
                          maxLength={200}
                          value={sc.visualIntent}
                          onChange={(e) => updateScene(i, { visualIntent: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`${id}-onscreen`} className="label">
                          Texte à l&apos;écran
                        </label>
                        <input
                          id={`${id}-onscreen`}
                          className="input"
                          maxLength={80}
                          placeholder="Aucun"
                          value={sc.onScreenText ?? ""}
                          onChange={(e) =>
                            updateScene(i, { onScreenText: e.target.value.trim() ? e.target.value : null })
                          }
                        />
                      </div>
                    </div>

                    <div className={s.grid}>
                      <div className="field">
                        <span className="label" id={`${id}-files`}>
                          Tes fichiers à l&apos;écran
                        </span>
                        {sc.visuals.length > 0 && (
                          <ul className={f.chips} aria-labelledby={`${id}-files`}>
                            {sc.visuals.map((v) => (
                              <li key={v} className={f.chip}>
                                {nameOf(v)}
                                <button
                                  type="button"
                                  aria-label={`Retirer ${nameOf(v)}`}
                                  onClick={() =>
                                    updateScene(i, { visuals: sc.visuals.filter((x) => x !== v) })
                                  }
                                >
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {available.length > 0 && sc.visuals.length < 4 ? (
                          <select
                            className="select"
                            aria-label={`Ajouter un fichier à la scène ${i + 1}`}
                            value=""
                            onChange={(e) =>
                              e.target.value && updateScene(i, { visuals: [...sc.visuals, e.target.value] })
                            }
                          >
                            <option value="">Ajouter un fichier…</option>
                            {available.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} ({KIND_LABELS[v.kind] ?? v.kind})
                              </option>
                            ))}
                          </select>
                        ) : (
                          sc.visuals.length === 0 && (
                            <p className="help">Pas de fichier : la scène aura un fond animé.</p>
                          )
                        )}
                      </div>
                      <div className="field">
                        <label htmlFor={`${id}-bg`} className="label">
                          Fond animé
                        </label>
                        <select
                          id={`${id}-bg`}
                          className="select"
                          value={sc.background}
                          onChange={(e) =>
                            updateScene(i, { background: e.target.value as SceneScript["background"] })
                          }
                        >
                          {BACKGROUND_STYLES.map((b) => (
                            <option key={b} value={b}>
                              {BACKGROUND_LABELS[b]}
                            </option>
                          ))}
                        </select>
                        <p className="help">Utilisé sans fichier, ou derrière le personnage.</p>
                      </div>
                    </div>

                    <fieldset className={f.fieldset}>
                      <legend className="label">Effets</legend>
                      <div className={s.checks}>
                        {EFFECTS.map((fx) => (
                          <label key={fx} className="option">
                            <input
                              type="checkbox"
                              checked={sc.effects.includes(fx)}
                              disabled={!sc.effects.includes(fx) && sc.effects.length >= 3}
                              onChange={(e) =>
                                updateScene(i, {
                                  effects: e.target.checked
                                    ? [...sc.effects, fx]
                                    : sc.effects.filter((x) => x !== fx),
                                })
                              }
                            />
                            {EFFECT_LABELS[fx]}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className={s.grid}>
                      <div className="field">
                        <label htmlFor={`${id}-emphasis`} className="label">
                          Mots forts
                        </label>
                        <input
                          id={`${id}-emphasis`}
                          className="input"
                          placeholder="Séparés par des virgules"
                          value={sc.emphasis.join(", ")}
                          onChange={(e) =>
                            updateScene(i, {
                              emphasis: e.target.value
                                .split(",")
                                .map((w) => w.trimStart())
                                .slice(0, 4),
                            })
                          }
                        />
                        <p className="help">Zoom choc et mise en avant dans les sous-titres.</p>
                      </div>
                      <div className="field">
                        <label htmlFor={`${id}-character`} className="label">
                          Personnage
                        </label>
                        <select
                          id={`${id}-character`}
                          className="select"
                          value={sc.character?.assetId ?? ""}
                          onChange={(e) =>
                            updateScene(i, {
                              character: e.target.value
                                ? { assetId: e.target.value, talking: sc.character?.talking ?? true }
                                : null,
                            })
                          }
                        >
                          <option value="">Aucun</option>
                          {characters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {sc.character ? (
                          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={sc.character.talking}
                              onChange={(e) =>
                                updateScene(i, {
                                  character: { assetId: sc.character!.assetId, talking: e.target.checked },
                                })
                              }
                            />
                            Il dit ce texte (bouche qui bouge)
                          </label>
                        ) : (
                          characters.length === 0 && (
                            <p className="help">Importe une image de type personnage pour l&apos;utiliser.</p>
                          )
                        )}
                      </div>
                    </div>

                    {i < script.scenes.length - 1 && (
                      <div className={s.transition}>
                        <label htmlFor={`${id}-transition`} className="caption subtle">
                          Vers la scène {i + 2}
                        </label>
                        <select
                          id={`${id}-transition`}
                          className="select"
                          value={sc.transition}
                          onChange={(e) =>
                            updateScene(i, { transition: e.target.value as SceneScript["transition"] })
                          }
                        >
                          {TRANSITIONS.map((t) => (
                            <option key={t} value={t}>
                              {TRANSITION_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {script.scenes.length < 12 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addScene}
                style={{ alignSelf: "flex-start" }}
              >
                <Plus size={20} aria-hidden="true" />
                Ajouter une scène
              </button>
            )}
          </div>
        </div>

        <aside className={styles.panel}>
          <h2>Toute la vidéo</h2>
          <div className="field">
            <label htmlFor="title" className="label">
              Titre
            </label>
            <input
              id="title"
              className="input"
              maxLength={80}
              value={script.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </div>
          <div className={s.meter}>
            <span className="muted">Durée estimée</span>
            <span className="tabular">
              {mmss(total)} <span className="subtle">/ {mmss(targetDurationSec)} visée</span>
            </span>
          </div>
          <div className="field">
            <label htmlFor="pace" className="label">
              Rythme du montage
            </label>
            <select
              id="pace"
              className="select"
              value={script.pace}
              onChange={(e) => update({ pace: e.target.value as Script["pace"] })}
            >
              {PACES.map((p) => (
                <option key={p} value={p}>
                  {PACE_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="music" className="label">
              Musique
            </label>
            <select
              id="music"
              className="select"
              value={script.musicAssetId ?? ""}
              onChange={(e) => update({ musicAssetId: e.target.value || null })}
            >
              <option value="">Aucune</option>
              {music.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={script.subtitles.enabled}
              onChange={(e) => update({ subtitles: { enabled: e.target.checked } })}
            />
            Sous-titres de ta voix
          </label>
          {hasTakes && textChanged && (
            <p className={`card ${s.warn}`}>
              Tu as déjà enregistré ta voix. Si tu changes le texte, refais une prise au prompteur pour que le
              montage colle à ce que tu dis.
            </p>
          )}
          <FormError message={msg.error} />
          <FormSuccess message={msg.ok} />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending}
            onClick={() => save(true)}
          >
            {pending ? "Enregistrement…" : "Valider le script et enregistrer ma voix"}
          </button>
          <p className="help">
            Pour repartir de zéro,{" "}
            <Link href={`/app/projets/${projectId}/idee`} className="link-underline">
              change ton idée
            </Link>{" "}
            et fais réécrire le script.
          </p>
        </aside>
      </div>
    </>
  );
}
