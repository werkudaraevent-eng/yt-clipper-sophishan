"use server";

import { headers } from "next/headers";
import { createCheckout, NOTIFY_PATH } from "@/lib/doku";
import { getLocale } from "@/lib/i18n/server";
import { paymentsEnabled, type CreditOrder } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${proto}://${host}`;
}

const PROMO_ERRORS = [
  "promo_not_found",
  "promo_expired",
  "promo_wrong_pack",
  "promo_used_up",
  "promo_already_used",
  "promo_too_big",
] as const;
export type PromoError = (typeof PROMO_ERRORS)[number] | "failed";

/** The database's reason a code was refused, or "failed" for anything else. */
function promoError(message: string | undefined): PromoError {
  return PROMO_ERRORS.find((e) => message?.includes(e)) ?? "failed";
}

export type Quote = {
  amount: number;
  list_amount: number;
  sale_amount: number;
  promo_code: string | null;
  promo_applied: boolean;
};

/** Price a pack with a promo code, for the confirm dialog's Apply button. */
export async function quotePromo(packId: string, code: string): Promise<{ quote: Quote } | { error: PromoError }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_credit_order", { p_pack: packId, p_promo: code });
  if (error || !data) return { error: promoError(error?.message) };
  return { quote: data as Quote };
}

export type BuyResult =
  | { url: string }
  | { error: "failed" | "tooMany" | "disabled" }
  | { promoError: PromoError };

/** Create an order for a pack (with an optional promo code) and return DOKU's payment page for it. */
export async function buyCredits(packId: string, promo: string | null = null): Promise<BuyResult> {
  if (!paymentsEnabled) return { error: "disabled" };
  const user = await currentUser();
  if (!user) return { error: "failed" };
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .rpc("create_credit_order", { p_pack: packId, p_promo: promo })
    .single<CreditOrder>();
  if (error || !order) {
    if (error?.message.includes("promo_")) return { promoError: promoError(error.message) };
    return { error: error?.message.includes("too_many_orders") ? "tooMany" : "failed" };
  }
  const site = await origin();
  try {
    const checkout = await createCheckout({
      invoiceNumber: order.invoice_number,
      amount: order.amount,
      itemName: `${order.credits} kredit Sophishan Clipper`,
      resultUrl: `${site}/credits/orders/${order.id}`,
      notifyUrl: `${site}${NOTIFY_PATH}`,
      customer: {
        id: user.id,
        email: user.email,
        name: (user.user_metadata?.full_name as string | undefined) ?? null,
      },
      locale: await getLocale(),
    });
    await supabase.rpc("attach_credit_order_payment", {
      p_order: order.id,
      p_url: checkout.url,
      p_pay_before: checkout.expiresAt,
    });
    return { url: checkout.url };
  } catch (e) {
    console.error("buyCredits", order.invoice_number, e);
    await supabase.rpc("cancel_credit_order", { p_order: order.id });
    return { error: "failed" };
  }
}

export async function cancelOrder(orderId: string) {
  const supabase = await createClient();
  await supabase.rpc("cancel_credit_order", { p_order: orderId });
}
