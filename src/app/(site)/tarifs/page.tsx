import { Check } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import styles from "@/components/home.module.css";
import { currentUser } from "@/lib/auth/session";
import { creatorPrice, offerFacts } from "@/lib/pricing";
import { stripeEnabled } from "@/lib/billing/stripe";
import { startCheckout } from "@/app/actions/billing";

export const metadata: Metadata = { title: "Tarifs" };

const yes = <Check size={20} aria-label="Inclus" />;

export default async function PricingPage() {
  const f = offerFacts();
  const user = await currentUser();
  const rows: [string, React.ReactNode, React.ReactNode][] = [
    ["Vidéos par mois", f.freeVideos, f.creatorVideos],
    ["Durée maximale par vidéo", `${f.freeMaxSec} s`, `${f.creatorMaxSec} s`],
    ["Script et montage par l'IA", yes, yes],
    ["Sous-titres automatiques", yes, yes],
    ["Prompteur", yes, yes],
    ["Brand Kit", yes, yes],
    ["Bibliothèque d'assets", yes, yes],
    ["Contrôle qualité automatique", yes, yes],
    ["Publication programmée", "Non", yes],
    ["Filigrane sur la vidéo", f.freeWatermark ? "Oui" : "Non", "Non"],
  ];
  const faq = [
    {
      q: "Que se passe-t-il quand j'atteins ma limite ?",
      a: "Tu ne peux plus lancer de nouveau montage ce mois-ci. Tes vidéos déjà faites restent disponibles. Le compteur repart le 1er du mois.",
    },
    {
      q: "Je peux changer d'offre quand je veux ?",
      a: "Oui. Tu passes à l'offre Créateur depuis ton compte. Tu résilies quand tu veux, l'offre reste active jusqu'à la fin du mois payé.",
    },
    {
      q: "Mes vidéos m'appartiennent ?",
      a: "Oui. Tes fichiers et tes vidéos restent à toi. Tu peux les télécharger et supprimer ton compte à tout moment.",
    },
    {
      q: "Comment l'IA utilise ma voix ?",
      a: "Ta voix sert seulement à monter tes vidéos : transcription pour les sous-titres et les coupes. Elle n'est ni clonée ni utilisée pour entraîner un modèle.",
    },
  ];
  const canPay = stripeEnabled();
  return (
    <>
      <section className={`${styles.container} ${styles.hero} appear`} style={{ paddingBottom: 64 }}>
        <h1 className="h1">Tarifs</h1>
        <p className={styles.lead}>
          Commence gratuitement. Passe à l&apos;offre Créateur quand tu publies plus.
        </p>
        <div className={styles.plans} style={{ width: "100%", marginTop: 32, textAlign: "left" }}>
          <div className={`card ${styles.plan}`}>
            <h2 className="h3">Gratuit</h2>
            <p className={styles.price}>0 €</p>
            <p className="ui muted" style={{ fontWeight: 400 }}>
              Pour tester sur tes premières vidéos.
            </p>
            <Link href={user ? "/app" : "/inscription"} className="btn btn-primary btn-site btn-block">
              Créer mon compte gratuit
            </Link>
          </div>
          <div className={`card ${styles.plan}`}>
            <h2 className="h3">Créateur</h2>
            <p className={styles.price}>
              {creatorPrice()} € <span className="ui muted">/ mois</span>
            </p>
            <p className="ui muted" style={{ fontWeight: 400 }}>
              Pour publier chaque semaine sur plusieurs plateformes.
            </p>
            {user && canPay ? (
              <form action={startCheckout}>
                <button
                  className="btn btn-secondary btn-site btn-block"
                  type="submit"
                  disabled={user.plan === "creator"}
                >
                  {user.plan === "creator" ? "Ton offre actuelle" : "Choisir l'offre Créateur"}
                </button>
              </form>
            ) : (
              <Link
                href={user ? "/app/compte" : "/inscription?offre=createur"}
                className="btn btn-secondary btn-site btn-block"
              >
                Choisir l&apos;offre Créateur
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container} style={{ maxWidth: 816 }}>
          <h2 className="h2" style={{ marginBottom: 24 }}>
            Ce que contient chaque offre
          </h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, lineHeight: "20px" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={th} className="muted" scope="col">
                    Fonction
                  </th>
                  <th style={th} scope="col">
                    Gratuit
                  </th>
                  <th style={th} scope="col">
                    Créateur
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, free, creator]) => (
                  <tr key={label} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <th scope="row" style={{ ...td, fontWeight: 400 }}>
                      {label}
                    </th>
                    <td style={td} className="muted tabular">
                      {free}
                    </td>
                    <td style={td} className="muted tabular">
                      {creator}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container} style={{ maxWidth: 816 }}>
          <h2 className="h2" style={{ marginBottom: 24 }}>
            Questions fréquentes
          </h2>
          <div className="card">
            {faq.map((item, i) => (
              <details key={item.q} style={{ borderTop: i ? "1px solid var(--color-border)" : undefined }}>
                <summary
                  style={{
                    listStyle: "none",
                    cursor: "pointer",
                    padding: "14px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontWeight: 500,
                    fontSize: 14,
                  }}
                >
                  {item.q}
                  <CaretDown size={16} aria-hidden="true" />
                </summary>
                <p className="ui muted measure" style={{ padding: "0 20px 16px", fontWeight: 400 }}>
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <h2 className="h2">Essaie sur une vraie vidéo.</h2>
        <Link href={user ? "/app/nouvelle-video" : "/inscription"} className="btn btn-secondary btn-site">
          Créer ma première vidéo
        </Link>
      </section>
    </>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, background: "var(--color-surface)" };
const td: React.CSSProperties = { padding: "10px 14px", textAlign: "left" };
