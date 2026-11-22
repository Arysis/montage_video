"use client";

import { MagicWand, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { type BrandKitInput, saveBrandKit } from "@/app/actions/assets";
import { type BrandProposal, MOOD_LABELS, MOODS, type Mood, proposeBrandKits } from "@/lib/brand-assistant";
import { BUILT_IN_FONTS, BUILT_IN_FAMILIES } from "@/lib/fonts";
import { contrastRatio } from "@/lib/qc/rules";
import { FormError, FormSuccess } from "./FormMessage";
import { TopBar } from "./TopBar";
import styles from "./app.module.css";
import b from "./brandkit.module.css";
import { useUpload } from "./useUpload";

type Image = { id: string; name: string; thumbKey: string | null };
type Font = { id: string; name: string; family: string | null; storageKey: string; mime: string };
type Slot = "logoAssetId" | "logoDarkAssetId";

const STYLES = [
  { value: "boxed", label: "Encadré", help: "Bandeau sombre derrière le texte" },
  { value: "outline", label: "Contour", help: "Texte seul avec un contour" },
  { value: "word", label: "Mot par mot", help: "Le mot lu est mis en avant" },
] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

function pick(colors: BrandKitInput["colors"], name: string, fallback: string) {
  return colors.find((c) => c.name.toLowerCase() === name.toLowerCase() && HEX.test(c.hex))?.hex ?? fallback;
}

export function BrandKitEditor({
  images,
  fonts,
  initial,
}: {
  images: Image[];
  fonts: Font[];
  initial: BrandKitInput;
}) {
  const router = useRouter();
  const [kit, setKit] = useState<BrandKitInput>(initial);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, startTransition] = useTransition();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [baseColor, setBaseColor] = useState<string | null>(null);
  const proposals = mood ? proposeBrandKits(mood, baseColor) : [];
  const dialog = useRef<HTMLDialogElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof BrandKitInput>(k: K, v: BrandKitInput[K]) => {
    setKit((prev) => ({ ...prev, [k]: v }));
    setMsg({});
  };

  const logoUpload = useUpload((asset) => {
    if (slot) set(slot, asset.id);
    dialog.current?.close();
    router.refresh();
  });
  const fontUpload = useUpload(() => {
    setMsg({ ok: "Police importée. Elle apparaît dans la liste dès qu'elle est analysée." });
    router.refresh();
  });

  const fontOptions = [
    ...BUILT_IN_FAMILIES,
    ...fonts.filter((f) => f.family && !BUILT_IN_FAMILIES.includes(f.family)).map((f) => f.family as string),
  ];
  const fontLabel = (f: string) => {
    const known = BUILT_IN_FONTS.find((x) => x.family === f);
    return known ? `${f} · ${known.label}` : `${f} · importée`;
  };
  const imageById = new Map(images.map((i) => [i.id, i]));
  const primary = pick(kit.colors, "Principale", kit.colors[0]?.hex ?? "#FF5A36");
  const background = pick(kit.colors, "Fond", "#0E0F11");
  const text = pick(kit.colors, "Texte", "#F2EFE9");
  const contrast = contrastRatio(text, background);
  const previewLogo = kit.logoDarkAssetId ?? kit.logoAssetId;
  const previewLogoImage = previewLogo ? imageById.get(previewLogo) : undefined;

  const save = () => {
    const invalid = kit.colors.find((c) => !HEX.test(c.hex));
    if (invalid) {
      setMsg({ error: `La couleur « ${invalid.name} » doit être au format #RRGGBB.` });
      return;
    }
    startTransition(async () => {
      setMsg(await saveBrandKit(kit));
    });
  };

  const applyProposal = (p: BrandProposal) => {
    // Les couleurs ajoutées par le créateur au-delà des quatre de base sont gardées.
    const extra = kit.colors.slice(4);
    setKit((prev) => ({
      ...prev,
      colors: [...p.colors, ...extra],
      titleFont: p.titleFont,
      bodyFont: p.bodyFont,
      subtitleStyle: p.subtitleStyle,
      subtitlePosition: p.subtitlePosition,
    }));
    setMsg({ ok: `DA « ${p.name} » appliquée. Ajuste ce que tu veux puis enregistre.` });
  };

  const openPicker = (s: Slot) => {
    setSlot(s);
    dialog.current?.showModal();
  };

  // Polices importées chargées pour l'aperçu.
  const fontFaces = fonts
    .filter((f) => f.family)
    .map(
      (f) =>
        `@font-face{font-family:${JSON.stringify(f.family)};src:url("/api/files/${f.storageKey}");font-display:swap;}`,
    )
    .join("\n");

  return (
    <>
      <style>{fontFaces}</style>
      <TopBar
        eyebrow="S'applique à toutes tes nouvelles vidéos"
        title="Brand Kit"
        actions={
          <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer mon Brand Kit"}
          </button>
        }
      />
      <div className={styles.body}>
        <div className={styles.contentNarrow}>
          <div className={styles.stack}>
            <div aria-live="polite">
              <FormError message={msg.error} />
              <FormSuccess message={msg.ok} />
            </div>

            <section className={styles.section} aria-labelledby="bk-assistant">
              <h2 id="bk-assistant" className={styles.sectionTitle}>
                <MagicWand size={20} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />
                Crée ta DA en 30 secondes
              </h2>
              <p className="help" style={{ marginBottom: 12 }}>
                Choisis l&apos;ambiance de ta chaîne. On te propose trois directions complètes (couleurs
                lisibles, polices, sous-titres) que tu peux appliquer puis retoucher.
              </p>
              <fieldset className={b.fieldset}>
                <legend className="label">Ambiance</legend>
                <div className={b.threeCols}>
                  {MOODS.map((m) => (
                    <label key={m} className={`option ${b.styleOption}`}>
                      <input
                        type="radio"
                        name="mood"
                        className="sr-only"
                        checked={mood === m}
                        onChange={() => setMood(m)}
                      />
                      <span style={{ fontWeight: 500 }}>{MOOD_LABELS[m].label}</span>
                      <span className="caption muted">{MOOD_LABELS[m].help}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className={b.baseColorRow}>
                <label
                  className={b.swatch}
                  style={{ background: baseColor ?? "transparent", width: 40, height: 40, margin: 0 }}
                >
                  <span className="sr-only">Une couleur que tu aimes</span>
                  <input
                    type="color"
                    value={baseColor ?? "#FF5A36"}
                    onChange={(e) => setBaseColor(e.target.value.toUpperCase())}
                  />
                </label>
                <span className="ui">
                  {baseColor ? `Partir de ${baseColor}` : "Une couleur que tu aimes déjà ? (facultatif)"}
                </span>
                {baseColor && (
                  <button type="button" className="link link-underline ui" onClick={() => setBaseColor(null)}>
                    Retirer
                  </button>
                )}
              </div>
              {proposals.length > 0 && (
                <ul className={b.proposals}>
                  {proposals.map((p) => {
                    const c = Object.fromEntries(p.colors.map((x) => [x.name, x.hex]));
                    return (
                      <li key={p.name} className={`card ${b.proposal}`}>
                        <div className={b.proposalPreview} style={{ background: c.Fond, color: c.Texte }}>
                          <span style={{ fontFamily: `"${p.titleFont}"`, fontSize: 26, lineHeight: 1.1 }}>
                            {p.name}
                          </span>
                          <span style={{ fontFamily: `"${p.bodyFont}"`, fontSize: 14 }}>
                            Ton message <span style={{ color: c.Principale, fontWeight: 600 }}>clé</span> ici
                          </span>
                        </div>
                        <div className={b.proposalSwatches} aria-hidden="true">
                          {p.colors.map((x) => (
                            <span key={x.name} style={{ background: x.hex }} title={`${x.name} ${x.hex}`} />
                          ))}
                        </div>
                        <p className="caption muted">{p.why}</p>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => applyProposal(p)}
                        >
                          Appliquer « {p.name} »
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={styles.section} aria-labelledby="bk-logo">
              <h2 id="bk-logo" className={styles.sectionTitle}>
                Logo
              </h2>
              <div className={b.logoGrid}>
                {(
                  [
                    ["logoAssetId", "Logo principal", false],
                    ["logoDarkAssetId", "Sur fond sombre", true],
                  ] as const
                ).map(([key, label, dark]) => {
                  const img = kit[key] ? imageById.get(kit[key]!) : undefined;
                  return (
                    <div key={key} className={`card ${b.logoCard}`}>
                      <div className={`placeholder-frame ${b.logoFrame}`} data-dark={dark || undefined}>
                        {img?.thumbKey ? (
                          <img src={`/api/files/${img.thumbKey}`} alt={img.name} />
                        ) : (
                          (img?.name ?? "Aucun logo")
                        )}
                      </div>
                      <div className={b.logoRow}>
                        <span className="ui">{label}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {img && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => set(key, null)}
                              aria-label={`Retirer ${label}`}
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openPicker(key)}
                          >
                            {img ? "Remplacer" : "Choisir"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="bk-colors">
              <h2 id="bk-colors" className={styles.sectionTitle}>
                Couleurs
              </h2>
              <div className={b.colorGrid}>
                {kit.colors.map((c, i) => (
                  <div key={i} className={`card ${b.colorCard}`}>
                    <label
                      className={b.swatch}
                      style={{ background: HEX.test(c.hex) ? c.hex : "transparent" }}
                    >
                      <span className="sr-only">Choisir la couleur {c.name}</span>
                      <input
                        type="color"
                        value={HEX.test(c.hex) ? c.hex : "#000000"}
                        onChange={(e) =>
                          set(
                            "colors",
                            kit.colors.map((x, j) =>
                              j === i ? { ...x, hex: e.target.value.toUpperCase() } : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <input
                      className={b.colorName}
                      aria-label="Nom de la couleur"
                      value={c.name}
                      maxLength={30}
                      onChange={(e) =>
                        set(
                          "colors",
                          kit.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <input
                      className={`${b.colorHex} tabular`}
                      aria-label={`Code de la couleur ${c.name}`}
                      value={c.hex}
                      maxLength={7}
                      onChange={(e) =>
                        set(
                          "colors",
                          kit.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)),
                        )
                      }
                    />
                    {i >= 4 && (
                      <button
                        type="button"
                        className={b.removeColor}
                        aria-label={`Retirer ${c.name}`}
                        onClick={() =>
                          set(
                            "colors",
                            kit.colors.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {kit.colors.length < 8 && (
                  <button
                    type="button"
                    className={b.addColor}
                    onClick={() =>
                      set("colors", [
                        ...kit.colors,
                        { name: `Couleur ${kit.colors.length + 1}`, hex: "#A3A8B0" },
                      ])
                    }
                  >
                    <Plus size={20} aria-hidden="true" />
                    Ajouter une couleur
                  </button>
                )}
              </div>
              <p className="help">Les noms Principale, Fond et Texte servent au montage.</p>
            </section>

            <section className={styles.section} aria-labelledby="bk-fonts">
              <h2 id="bk-fonts" className={styles.sectionTitle}>
                Polices
              </h2>
              <div className={b.twoCols}>
                {(
                  [
                    ["titleFont", "Titres"],
                    ["bodyFont", "Texte et sous-titres"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="field">
                    <label htmlFor={key} className="label">
                      {label}
                    </label>
                    <select
                      id={key}
                      className="select"
                      value={kit[key]}
                      onChange={(e) => set(key, e.target.value)}
                    >
                      {fontOptions.map((f) => (
                        <option key={f} value={f}>
                          {fontLabel(f)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="link link-underline ui"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => fontInput.current?.click()}
                    >
                      Importer une police
                    </button>
                  </div>
                ))}
              </div>
              {fontUpload.items
                .filter((i) => !i.asset)
                .map((i) => (
                  <p key={i.key} className={i.error ? "error-text" : "help"}>
                    {i.name} {i.error ? `: ${i.error}` : `· ${Math.round(i.progress * 100)} %`}
                  </p>
                ))}
              <input
                ref={fontInput}
                type="file"
                hidden
                accept=".ttf,.otf"
                onChange={(e) => {
                  if (e.target.files) void fontUpload.upload(e.target.files, "font");
                  e.target.value = "";
                }}
              />
            </section>

            <section className={styles.section} aria-labelledby="bk-subs">
              <h2 id="bk-subs" className={styles.sectionTitle}>
                Style de sous-titres
              </h2>
              <fieldset className={b.fieldset}>
                <legend className="label">Rendu</legend>
                <div className={b.threeCols}>
                  {STYLES.map((s) => (
                    <label key={s.value} className={`option ${b.styleOption}`}>
                      <input
                        type="radio"
                        name="subtitleStyle"
                        className="sr-only"
                        checked={kit.subtitleStyle === s.value}
                        onChange={() => set("subtitleStyle", s.value)}
                      />
                      <span style={{ fontWeight: 500 }}>{s.label}</span>
                      <span className="caption muted">{s.help}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className={b.fieldset}>
                <legend className="label">Position</legend>
                <div style={{ display: "flex", gap: 8 }}>
                  {(
                    [
                      ["bottom", "En bas"],
                      ["center", "Au centre"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="option">
                      <input
                        type="radio"
                        name="subtitlePosition"
                        className="sr-only"
                        checked={kit.subtitlePosition === v}
                        onChange={() => set("subtitlePosition", v)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          </div>
        </div>

        <aside className={styles.panel} aria-label="Aperçu">
          <h2>Aperçu</h2>
          <div className={b.preview} style={{ background }}>
            <div className={b.previewLogo}>
              {previewLogoImage?.thumbKey ? (
                <img src={`/api/files/${previewLogoImage.thumbKey}`} alt="" />
              ) : (
                <span className="caption" style={{ color: text, opacity: 0.6 }}>
                  [Logo]
                </span>
              )}
            </div>
            <p
              className={b.previewTitle}
              style={{ fontFamily: `"${kit.titleFont}", var(--font-display)`, color: text }}
            >
              Ton titre
            </p>
            <p
              className={b.previewSub}
              data-position={kit.subtitlePosition}
              style={{
                fontFamily: `"${kit.bodyFont}", var(--font-body)`,
                color: text,
                background: kit.subtitleStyle === "boxed" ? `${background}E6` : "transparent",
                textShadow:
                  kit.subtitleStyle === "boxed"
                    ? "none"
                    : `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000`,
              }}
            >
              Commence par <span style={{ color: kit.subtitleStyle === "word" ? primary : text }}>le</span>{" "}
              résultat.
            </p>
          </div>
          <p className="caption muted">La couleur de mise en avant vient de ta couleur principale.</p>
          {contrast < 4.5 && (
            <p className="error-text">
              Le texte et le fond manquent de contraste ({contrast.toFixed(1).replace(".", ",")} pour 4,5
              attendu). Les sous-titres seront difficiles à lire.
            </p>
          )}
        </aside>
      </div>

      <dialog ref={dialog} aria-labelledby="logo-picker-title" onClose={() => setSlot(null)}>
        <h2 id="logo-picker-title" className="h3" style={{ marginBottom: 16 }}>
          {slot === "logoDarkAssetId" ? "Logo sur fond sombre" : "Logo principal"}
        </h2>
        {images.length === 0 ? (
          <p className="muted" style={{ marginBottom: 16 }}>
            Aucune image dans ta bibliothèque. Importe ton logo.
          </p>
        ) : (
          <ul className={b.pickerGrid}>
            {images.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  className={`card card-hover ${b.pickerItem} ${slot && kit[slot] === img.id ? "card-selected" : ""}`}
                  onClick={() => {
                    if (slot) set(slot, img.id);
                    dialog.current?.close();
                  }}
                >
                  {img.thumbKey ? (
                    <img src={`/api/files/${img.thumbKey}`} alt="" />
                  ) : (
                    <span className="placeholder-frame" style={{ aspectRatio: 1 }}>
                      Analyse…
                    </span>
                  )}
                  <span className="caption">{img.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {logoUpload.items
          .filter((i) => !i.asset)
          .map((i) => (
            <p key={i.key} className={i.error ? "error-text" : "help"}>
              {i.name} {i.error ? `: ${i.error}` : `· ${Math.round(i.progress * 100)} %`}
            </p>
          ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 16,
            flexWrap: "wrap",
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={() => logoInput.current?.click()}>
            <UploadSimple size={20} aria-hidden="true" />
            Importer un logo
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>
            Fermer
          </button>
        </div>
        <input
          ref={logoInput}
          type="file"
          hidden
          accept=".png,.svg,.webp,.jpg,.jpeg"
          onChange={(e) => {
            if (e.target.files) void logoUpload.upload(e.target.files, "logo");
            e.target.value = "";
          }}
        />
      </dialog>
    </>
  );
}
