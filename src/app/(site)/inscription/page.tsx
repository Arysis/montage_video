import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import styles from "@/components/auth.module.css";
import { currentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ offre?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { offre } = await searchParams;
  return (
    <div className={styles.page}>
      <h1 className="h1">Crée ton compte</h1>
      <p className="muted">Ta première vidéo est gratuite.</p>
      <AuthForm mode="signup" offer={offre === "createur" ? "createur" : undefined} />
    </div>
  );
}
