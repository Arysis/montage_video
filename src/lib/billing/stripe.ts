import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { env } from "@/lib/env";

let client: Stripe | undefined;

export function stripeEnabled(): boolean {
  const e = env();
  return !!(e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_CREATOR);
}

export function stripe(): Stripe {
  if (!client) {
    const key = env().STRIPE_SECRET_KEY;
    if (!key) throw new Error("Paiement non configuré (STRIPE_SECRET_KEY).");
    client = new Stripe(key);
  }
  return client;
}

export async function checkoutUrl(user: User): Promise<string> {
  const e = env();
  let customer = user.stripeCustomerId;
  if (!customer) {
    const c = await stripe().customers.create({ email: user.email, metadata: { userId: user.id } });
    customer = c.id;
    await db().update(schema.users).set({ stripeCustomerId: customer }).where(eq(schema.users.id, user.id));
  }
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: e.STRIPE_PRICE_CREATOR!, quantity: 1 }],
    client_reference_id: user.id,
    success_url: `${e.APP_URL}/app/compte?abonnement=ok`,
    cancel_url: `${e.APP_URL}/tarifs`,
    locale: "fr",
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
  });
  if (!session.url) throw new Error("Stripe n'a pas renvoyé de lien de paiement.");
  return session.url;
}

export async function portalUrl(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new Error("Aucun abonnement.");
  const s = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env().APP_URL}/app/compte`,
  });
  return s.url;
}

/** Applique un événement Stripe (webhook) à l'offre de l'utilisateur. */
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    if (s.mode !== "subscription" || !s.client_reference_id) return;
    await db()
      .update(schema.users)
      .set({
        plan: "creator",
        stripeCustomerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
        stripeSubscriptionId:
          typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null),
      })
      .where(eq(schema.users.id, s.client_reference_id));
    return;
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const active =
      event.type === "customer.subscription.updated" &&
      ["active", "trialing", "past_due"].includes(sub.status);
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    await db()
      .update(schema.users)
      .set({ plan: active ? "creator" : "free", stripeSubscriptionId: active ? sub.id : null })
      .where(eq(schema.users.stripeCustomerId, customer));
  }
}
