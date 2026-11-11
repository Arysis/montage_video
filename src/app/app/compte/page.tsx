import type { Metadata } from "next";
import Link from "next/link";
import { openBillingPortal, startCheckout } from "@/app/actions/billing";
import { signOut } from "@/app/actions/auth";
import { DeleteAccountForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import styles from "@/components/app.module.css";
import { FormError, FormSuccess } from "@/components/FormMessage";
import { TopBar } from "@/components/TopBar";
import { requireUser } from "@/lib/auth/session";
import { PLAN_LABELS, planLimits } from "@/lib/billing/plans";
import { stripeEnabled } from "@/lib/billing/stripe";
import { creatorPrice } from "@/lib/pricing";
import { usage } from "@/lib/projects";

export const metadata: Metadata = { title: "Ton compte" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ paiement?: string; offre?: string; abonnement?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const u = await usage(user);
  const limits = planLimits(user.plan);
  const creator = planLimits("creator");
  const pct = Math.min(100, Math.round((u.used / Math.max(1, u.limit)) * 100));

  return (
    <>
      <TopBar title="Ton compte" />
      <div className={styles.body}>
        <div className={styles.contentNarrow}>
          <div className={styles.stack}>
            <section className={styles.section} aria-labelledby="plan-title">
              <h2 id="plan-title" className={styles.sectionTitle}>
                Ton offre
              </h2>
              <FormError
                message={
                  sp.paiement === "indisponible"
                    ? "Le paiement n'est pas encore ouvert. Réessaie bientôt."
                    : undefined
                }
              />
              <FormSuccess
                message={sp.abonnement === "ok" ? "Merci. Ton offre Créateur est active." : undefined}
              />
              <div
                className="card"
                style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <p className="h3">{PLAN_LABELS[user.plan]}</p>
                  <p className="caption muted tabular">
                    {u.used} / {u.limit} vidéos ce mois
                  </p>
                </div>
                <div
                  className="progress progress-primary"
                  role="progressbar"
                  aria-valuenow={u.used}
                  aria-valuemax={u.limit}
                  aria-label="Vidéos utilisées ce mois"
                >
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="caption subtle">
                  Vidéos de {limits.maxDurationSec} s au plus. Le compteur repart le 1er du mois.
                </p>
              </div>
              {user.plan === "free" ? (
                <div
                  className={`card ${sp.offre === "createur" ? "card-selected" : ""}`}
                  style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <p style={{ fontWeight: 600 }}>Offre Créateur · {creatorPrice()} € par mois</p>
                  <p className="muted">
                    {creator.videosPerMonth} vidéos par mois, jusqu&apos;à {creator.maxDurationSec} s, et la
                    publication programmée. Sans engagement.
                  </p>
                  <form action={startCheckout}>
                    <button type="submit" className="btn btn-primary" disabled={!stripeEnabled()}>
                      Passer à l&apos;offre Créateur
                    </button>
                  </form>
                  <Link href="/tarifs" className="link link-underline caption">
                    Comparer les offres
                  </Link>
                </div>
              ) : (
                user.stripeCustomerId && (
                  <form action={openBillingPortal}>
                    <button type="submit" className="btn btn-secondary">
                      Gérer mon abonnement et mes factures
                    </button>
                  </form>
                )
              )}
            </section>

            <section className={styles.section} aria-labelledby="profile-title">
              <h2 id="profile-title" className={styles.sectionTitle}>
                Profil
              </h2>
              <ProfileForm firstName={user.firstName ?? ""} email={user.email} />
            </section>

            <section className={styles.section} aria-labelledby="password-title">
              <h2 id="password-title" className={styles.sectionTitle}>
                Mot de passe
              </h2>
              <PasswordForm />
            </section>

            <section className={styles.section} aria-labelledby="data-title">
              <h2 id="data-title" className={styles.sectionTitle}>
                Tes données
              </h2>
              <p className="muted">
                Télécharge un fichier avec toutes tes données et les liens vers tes fichiers.{" "}
                <Link href="/confidentialite" className="link-underline">
                  Confidentialité
                </Link>
              </p>
              <a href="/api/compte/export" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                Télécharger mes données
              </a>
            </section>

            <section className={styles.section} aria-labelledby="session-title">
              <h2 id="session-title" className={styles.sectionTitle}>
                Session
              </h2>
              <form action={signOut}>
                <button type="submit" className="btn btn-secondary">
                  Me déconnecter
                </button>
              </form>
            </section>

            <section className={styles.section} aria-labelledby="delete-title">
              <h2 id="delete-title" className={styles.sectionTitle}>
                Supprimer mon compte
              </h2>
              <DeleteAccountForm hasSubscription={!!user.stripeSubscriptionId} />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
