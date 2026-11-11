"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp } from "@/app/actions/auth";
import { FormError } from "./FormMessage";
import styles from "./auth.module.css";

export function AuthForm({
  mode,
  offer,
  next,
}: {
  mode: "signup" | "signin";
  offer?: string;
  next?: string;
}) {
  const [state, action, pending] = useActionState(mode === "signup" ? signUp : signIn, undefined);
  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.switch} role="tablist" aria-label="Type de formulaire">
        <Link href="/inscription" role="tab" aria-selected={mode === "signup"} className="tab">
          Créer un compte
        </Link>
        <Link href="/connexion" role="tab" aria-selected={mode === "signin"} className="tab">
          Se connecter
        </Link>
      </div>
      <form action={action} className={styles.form} noValidate>
        {offer && <input type="hidden" name="offre" value={offer} />}
        {next && <input type="hidden" name="next" value={next} />}
        <div className="field">
          <label className="label" htmlFor="email">
            E-mail
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="toi@exemple.fr"
            defaultValue={state?.fields?.email}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Mot de passe
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
            aria-describedby={mode === "signup" ? "password-help" : undefined}
          />
          {mode === "signup" ? (
            <p id="password-help" className="help">
              10 caractères au moins.
            </p>
          ) : (
            <Link href="/mot-de-passe-oublie" className="help link" style={{ alignSelf: "flex-start" }}>
              Mot de passe oublié
            </Link>
          )}
        </div>
        <FormError message={state?.error} />
        <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
          {mode === "signup" ? "Créer mon compte" : "Me connecter"}
        </button>
        {mode === "signup" && (
          <p className="caption muted">
            En créant ton compte, tu acceptes les{" "}
            <Link href="/cgv" className="link-underline">
              CGV
            </Link>{" "}
            et la{" "}
            <Link href="/confidentialite" className="link-underline">
              politique de confidentialité
            </Link>
            .
          </p>
        )}
      </form>
    </div>
  );
}
