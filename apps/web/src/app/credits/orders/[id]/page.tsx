import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { count, rupiah } from "@/lib/credit-packs";
import { dayAndTime } from "@/lib/format";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { channelLabel, ORDER_COLUMNS, refreshOrder, type CreditOrder } from "@/lib/payments";
import { currentCredits, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { OrderStatusView } from "./status";

/** Where DOKU sends the buyer back to, and where a pending order is followed. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/credits/orders/${id}`);
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("credit_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle<CreditOrder>();
  if (!order) notFound();

  // Coming back from DOKU right after paying: settle now if the webhook is behind.
  let status = order.status;
  try {
    status = await refreshOrder(order);
  } catch (e) {
    console.error("order page refresh", order.invoice_number, e);
  }
  const [t, locale, balance] = await Promise.all([getDictionary(), getLocale(), currentCredits(user)]);
  const pack = `${count(order.credits, locale)} ${t.buy.credits}`;

  return (
    <AppShell user={user} title={t.order.title} backHref="/credits">
      <OrderStatusView
        t={t}
        locale={locale}
        order={{
          id: order.id,
          packId: order.pack_id,
          status,
          credits: count(order.credits, locale),
          invoice: order.invoice_number,
          pack,
          total: rupiah(order.amount),
          payBefore: order.pay_before,
          payBeforeLabel: dayAndTime(order.pay_before, locale),
          method: channelLabel(order.channel),
          paidAt: order.paid_at ? dayAndTime(order.paid_at, locale) : null,
          paymentUrl: order.payment_url,
        }}
        balance={balance ?? 0}
      />
    </AppShell>
  );
}
