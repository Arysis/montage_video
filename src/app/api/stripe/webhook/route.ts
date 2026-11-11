import { applyStripeEvent, stripe, stripeEnabled } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { json } from "@/lib/http";

export const runtime = "nodejs";

/** Webhook Stripe : la signature est vérifiée avant toute action. */
export async function POST(req: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) return json({ error: "Paiement non configuré." }, 503);
  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Signature manquante." }, 400);
  const body = await req.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return json({ error: "Signature invalide." }, 400);
  }
  try {
    await applyStripeEvent(event);
  } catch (err) {
    console.error("[stripe] webhook", event.type, err);
    return json({ error: "Erreur de traitement." }, 500);
  }
  return json({ received: true });
}
