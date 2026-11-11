import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { hashToken, newToken } from "./tokens";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db()
    .insert(schema.sessions)
    .values({ id: hashToken(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  // Ménage des sessions expirées de cet utilisateur.
  await db()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), lt(schema.sessions.expiresAt, new Date())));
}

export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db()
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

/** Utilisateur connecté (une seule requête par rendu). */
export const currentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token)
    await db()
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
