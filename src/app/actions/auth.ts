"use server";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { emailSchema, hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { clientIp, createSession, destroySession } from "@/lib/auth/session";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { db, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { appName } from "@/lib/brand";

export type FormState = { error?: string; ok?: string; fields?: Record<string, string> } | undefined;

const TOO_MANY = "Trop de tentatives. Réessaie dans quelques minutes.";

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse({
    email,
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message, fields: { email } };
  if (!(await rateLimit(`signup:${await clientIp()}`, 10, 3600)))
    return { error: TOO_MANY, fields: { email } };

  const existing = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${parsed.data.email}`);
  if (existing.length) {
    return { error: "Un compte existe déjà avec cet e-mail. Connecte-toi.", fields: { email } };
  }
  const [user] = await db()
    .insert(schema.users)
    .values({ email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password) })
    .returning();
  await db().insert(schema.brandKits).values({ userId: user!.id }).onConflictDoNothing();
  await createSession(user!.id);
  redirect(form.get("offre") === "createur" ? "/app/compte?offre=createur" : "/app/nouvelle-video");
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Indique ton e-mail et ton mot de passe.", fields: { email } };
  const ip = await clientIp();
  if (!(await rateLimit(`login:ip:${ip}`, 30, 900)) || !(await rateLimit(`login:email:${email}`, 8, 900))) {
    return { error: TOO_MANY, fields: { email } };
  }
  const [user] = await db()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`);
  // Même réponse que le compte existe ou non, et un hachage dans tous les cas (pas de fuite par le temps de réponse).
  const ok = user ? await verifyPassword(user.passwordHash, password) : (await hashPassword(password), false);
  if (!user || !ok) return { error: "E-mail ou mot de passe incorrect.", fields: { email } };
  await createSession(user.id);
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/app") ? next : "/app");
}

export async function signOut() {
  await destroySession();
  redirect("/");
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Adresse e-mail invalide." };
  if (!(await rateLimit(`reset:${await clientIp()}`, 5, 3600))) return { error: TOO_MANY };
  const [user] = await db()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${parsed.data}`);
  if (user) {
    const token = newToken();
    await db()
      .insert(schema.passwordResets)
      .values({ id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
    await sendEmail({
      to: user.email,
      subject: `Réinitialise ton mot de passe ${appName()}`,
      text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) :\n${env().APP_URL}/reinitialiser?jeton=${token}\n\nSi tu n'as rien demandé, ignore cet e-mail.`,
    });
  }
  return { ok: "Si un compte existe avec cet e-mail, tu vas recevoir un lien." };
}

export async function resetPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const parsed = passwordSchema.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const [reset] = await db()
    .select()
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.id, hashToken(token)),
        gt(schema.passwordResets.expiresAt, new Date()),
        isNull(schema.passwordResets.usedAt),
      ),
    );
  if (!reset) return { error: "Ce lien a expiré. Demande un nouveau lien." };
  await db()
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data) })
    .where(eq(schema.users.id, reset.userId));
  await db()
    .update(schema.passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResets.id, reset.id));
  // On déconnecte toutes les sessions existantes.
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, reset.userId));
  await createSession(reset.userId);
  redirect("/app");
}
