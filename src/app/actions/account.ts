"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { destroySession, requireUser } from "@/lib/auth/session";
import { stripe, stripeEnabled } from "@/lib/billing/stripe";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

export type AccountState = { error?: string; ok?: string } | undefined;

export async function updateProfile(_prev: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  const parsed = z
    .string()
    .trim()
    .max(60, "Prénom trop long.")
    .safeParse(form.get("firstName") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  await db()
    .update(schema.users)
    .set({ firstName: parsed.data || null })
    .where(eq(schema.users.id, user.id));
  revalidatePath("/app", "layout");
  return { ok: "Prénom enregistré." };
}

export async function changePassword(_prev: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  if (!(await rateLimit(`password:${user.id}`, 5, 900)))
    return { error: "Trop de tentatives. Réessaie plus tard." };
  const current = String(form.get("current") ?? "");
  const next = passwordSchema.safeParse(String(form.get("next") ?? ""));
  if (!next.success) return { error: next.error.issues[0]!.message };
  if (!(await verifyPassword(user.passwordHash, current))) return { error: "Mot de passe actuel incorrect." };
  await db()
    .update(schema.users)
    .set({ passwordHash: await hashPassword(next.data) })
    .where(eq(schema.users.id, user.id));
  // Les autres appareils sont déconnectés.
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  await destroySession();
  redirect("/connexion?motdepasse=change");
}

/** Supprime le compte, les données et les fichiers. L'abonnement est résilié tout de suite. */
export async function deleteAccount(_prev: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  if (
    String(form.get("confirm") ?? "")
      .trim()
      .toUpperCase() !== "SUPPRIMER"
  ) {
    return { error: "Écris SUPPRIMER pour confirmer." };
  }
  if (!(await verifyPassword(user.passwordHash, String(form.get("password") ?? "")))) {
    return { error: "Mot de passe incorrect." };
  }
  if (user.stripeSubscriptionId && stripeEnabled()) {
    try {
      await stripe().subscriptions.cancel(user.stripeSubscriptionId);
    } catch (err) {
      console.error("[compte] résiliation", err);
      return { error: "La résiliation de l'abonnement a échoué. Réessaie ou écris-nous." };
    }
  }
  await storage()
    .deletePrefix(`u/${user.id}/`)
    .catch((err) => console.error("[compte] fichiers", err));
  // Les projets, fichiers, prises, sessions et publications partent en cascade.
  await db().delete(schema.users).where(eq(schema.users.id, user.id));
  await destroySession();
  redirect("/?compte=supprime");
}
