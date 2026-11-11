"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { checkoutUrl, portalUrl, stripeEnabled } from "@/lib/billing/stripe";

export async function startCheckout() {
  const user = await requireUser();
  if (!stripeEnabled()) redirect("/app/compte?paiement=indisponible");
  if (user.plan === "creator") redirect("/app/compte");
  redirect(await checkoutUrl(user));
}

export async function openBillingPortal() {
  const user = await requireUser();
  redirect(await portalUrl(user));
}
