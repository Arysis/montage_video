"use client";

import { useActionState } from "react";
import { requestPasswordReset, resetPassword } from "@/app/actions/auth";
import { FormError, FormSuccess } from "./FormMessage";
import styles from "./auth.module.css";

export function RequestResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className={`card ${styles.card}`}>
      <div className="field">
        <label className="label" htmlFor="email">
          E-mail
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <FormError message={state?.error} />
      <FormSuccess message={state?.ok} />
      <button className="btn btn-primary btn-block" disabled={pending}>
        Recevoir un lien
      </button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className={`card ${styles.card}`}>
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label className="label" htmlFor="password">
          Nouveau mot de passe
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <p className="help">10 caractères au moins.</p>
      </div>
      <FormError message={state?.error} />
      <button className="btn btn-primary btn-block" disabled={pending}>
        Enregistrer mon mot de passe
      </button>
    </form>
  );
}
