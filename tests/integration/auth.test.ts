import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { userFromToken } from "@/lib/auth/session";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { closeDb, db, schema } from "@/lib/db";
import { setupIntegration } from "./setup";

beforeAll(async () => {
  await setupIntegration();
});
afterAll(async () => {
  await closeDb();
});

describe("comptes et sessions", () => {
  it("hache les mots de passe et refuse les mots de passe faibles", async () => {
    const h = await hashPassword("un-mot-de-passe-solide");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, "un-mot-de-passe-solide")).toBe(true);
    expect(await verifyPassword(h, "autre-chose-encore")).toBe(false);
    expect(passwordSchema.safeParse("court").success).toBe(false);
    expect(passwordSchema.safeParse("azertyuiop").success).toBe(false);
  });

  it("ne stocke que l'empreinte du jeton de session", async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({ email: "session@example.com", passwordHash: await hashPassword("un-mot-de-passe-solide") })
      .returning();
    const token = newToken();
    await db()
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId: user!.id, expiresAt: new Date(Date.now() + 3600_000) });
    expect((await userFromToken(token))?.id).toBe(user!.id);
    expect(await userFromToken(hashToken(token))).toBeNull();
    expect(await userFromToken("faux")).toBeNull();

    await db()
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.userId, user!.id));
    expect(await userFromToken(token)).toBeNull();
  });

  it("limite les tentatives", async () => {
    const key = `test:${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(key, 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  it("supprime en cascade les données d'un compte", async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({ email: "cascade@example.com", passwordHash: "x" })
      .returning();
    await db().insert(schema.projects).values({ userId: user!.id, name: "P", idea: "Une idée de test" });
    await db().delete(schema.users).where(eq(schema.users.id, user!.id));
    expect(await db().select().from(schema.projects).where(eq(schema.projects.userId, user!.id))).toEqual([]);
  });
});
