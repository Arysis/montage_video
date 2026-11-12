import { env } from "@/lib/env";

export type Email = { to: string; subject: string; text: string };

/** Envoie un e-mail transactionnel (Resend) ou l'écrit dans les logs en développement. */
export async function sendEmail(mail: Email): Promise<void> {
  const e = env();
  if (e.EMAIL_PROVIDER === "log") {
    console.info(`[email] À : ${mail.to}\nObjet : ${mail.subject}\n\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Envoi d'e-mail impossible (${res.status})`);
}
