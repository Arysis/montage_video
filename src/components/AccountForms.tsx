"use client";

import { useActionState } from "react";
import { changePassword, deleteAccount, updateProfile } from "@/app/actions/account";
import { FormError, FormSuccess } from "./FormMessage";

export function ProfileForm({ firstName, email }: { firstName: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="field">
        <label htmlFor="email" className="label">
          E-mail
        </label>
        <input id="email" className="input" value={email} readOnly disabled />
      </div>
      <div className="field">
        <label htmlFor="firstName" className="label">
          Prénom
        </label>
        <input
          id="firstName"
          name="firstName"
          className="input"
          defaultValue={firstName}
          maxLength={60}
          autoComplete="given-name"
        />
      </div>
      <FormError message={state?.error} />
      <FormSuccess message={state?.ok} />
      <button
        type="submit"
        className="btn btn-secondary"
        disabled={pending}
        style={{ alignSelf: "flex-start" }}
      >
        Enregistrer
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="field">
        <label htmlFor="current" className="label">
          Mot de passe actuel
        </label>
        <input
          id="current"
          name="current"
          type="password"
          className="input"
          required
          autoComplete="current-password"
        />
      </div>
      <div className="field">
        <label htmlFor="next" className="label">
          Nouveau mot de passe
        </label>
        <input
          id="next"
          name="next"
          type="password"
          className="input"
          required
          minLength={10}
          autoComplete="new-password"
        />
        <p className="help">10 caractères au moins. Tes autres appareils seront déconnectés.</p>
      </div>
      <FormError message={state?.error} />
      <button
        type="submit"
        className="btn btn-secondary"
        disabled={pending}
        style={{ alignSelf: "flex-start" }}
      >
        Changer mon mot de passe
      </button>
    </form>
  );
}

export function DeleteAccountForm({ hasSubscription }: { hasSubscription: boolean }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="muted">
        Tes vidéos, tes fichiers, tes prises et ton Brand Kit sont effacés tout de suite. C&apos;est
        définitif.
        {hasSubscription ? " Ton abonnement est résilié en même temps." : ""}
      </p>
      <div className="field">
        <label htmlFor="confirm" className="label">
          Écris SUPPRIMER pour confirmer
        </label>
        <input id="confirm" name="confirm" className="input" required autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="delete-password" className="label">
          Ton mot de passe
        </label>
        <input
          id="delete-password"
          name="password"
          type="password"
          className="input"
          required
          autoComplete="current-password"
        />
      </div>
      <FormError message={state?.error} />
      <button
        type="submit"
        className="btn btn-secondary"
        disabled={pending}
        style={{ alignSelf: "flex-start", color: "var(--color-danger)" }}
      >
        {pending ? "Suppression…" : "Supprimer mon compte"}
      </button>
    </form>
  );
}
