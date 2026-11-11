import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import styles from "@/components/auth.module.css";
import { currentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Se connecter" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; motdepasse?: string }>;
}) {
  if (await currentUser()) redirect("/app");
  const { next, motdepasse } = await searchParams;
  return (
    <div className={styles.page}>
      <h1 className="h1">Content de te revoir</h1>
      <p className="muted">
        {motdepasse === "change"
          ? "Mot de passe changé. Connecte-toi avec le nouveau."
          : "Connecte-toi pour retrouver tes vidéos."}
      </p>
      <AuthForm mode="signin" next={next} />
    </div>
  );
}
