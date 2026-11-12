import type { Metadata } from "next";
import styles from "@/components/auth.module.css";
import { RequestResetForm } from "@/components/ResetForms";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPage() {
  return (
    <div className={styles.page}>
      <h1 className="h1">Mot de passe oublié</h1>
      <p className="muted">Indique ton e-mail. On t&apos;envoie un lien pour en choisir un nouveau.</p>
      <RequestResetForm />
    </div>
  );
}
