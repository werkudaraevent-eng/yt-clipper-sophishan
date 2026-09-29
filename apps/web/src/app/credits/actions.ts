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

export type BuyResult = { url: string } | { error: "failed" | "tooMany" | "disabled" };

/** Create an order for a pack and return DOKU's payment page for it. */
export async function buyCredits(packId: string): Promise<BuyResult> {
  if (!paymentsEnabled) return { error: "disabled" };
  const user = await currentUser();
  if (!user) return { error: "failed" };
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .rpc("create_credit_order", { p_pack: packId })
    .single<CreditOrder>();
  if (error || !order) {
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
