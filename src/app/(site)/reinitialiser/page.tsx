import type { Metadata } from "next";
import styles from "@/components/auth.module.css";
import { ResetForm } from "@/components/ResetForms";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ jeton?: string }> }) {
  const { jeton } = await searchParams;
  return (
    <div className={styles.page}>
      <h1 className="h1">Choisis un mot de passe</h1>
      <ResetForm token={jeton ?? ""} />
    </div>
  );
}
