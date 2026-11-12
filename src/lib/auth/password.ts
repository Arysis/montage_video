import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

/** Règle du mot de passe : 10 caractères au moins, pas un mot de passe trop courant. */
export const PASSWORD_RULE = "10 caractères au moins.";

const COMMON = new Set(["motdepasse", "password12", "azertyuiop", "1234567890", "qwertyuiop", "0123456789"]);

export const passwordSchema = z
  .string()
  .min(10, "Ton mot de passe doit faire 10 caractères au moins.")
  .max(200, "Ton mot de passe est trop long.")
  .refine((p) => !COMMON.has(p.toLowerCase()), "Ce mot de passe est trop courant.");

export const emailSchema = z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(254);

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
