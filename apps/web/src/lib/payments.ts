import { createClient as createPlainClient } from "@supabase/supabase-js";
import { checkStatus, dokuConfigured, type DokuStatus } from "./doku";

/**
 * Credit purchases. Orders live in public.credit_orders; settling one (adding
 * the credits) goes through settle_credit_order, which only accepts the
 * shared PAYMENTS_DB_TOKEN because the payment webhook has no user session.
 */
const DB_TOKEN = process.env.PAYMENTS_DB_TOKEN;

export const paymentsEnabled = dokuConfigured && Boolean(DB_TOKEN);

export type CreditPack = {
  id: string;
  credits: number;
  price_idr: number;
  featured: boolean;
};

export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";

export type CreditOrder = {
  id: string;
  pack_id: string;
  credits: number;
  amount: number;
  invoice_number: string;
  status: OrderStatus;
  payment_url: string | null;
  channel: string | null;
  pay_before: string;
  paid_at: string | null;
  created_at: string;
};

export const ORDER_COLUMNS =
  "id, pack_id, credits, amount, invoice_number, status, payment_url, channel, pay_before, paid_at, created_at";

/** Apply a DOKU result to the order. Returns the order's status afterwards. */
export async function settleOrder(invoice: string, status: DokuStatus, channel: string | null, amount: number | null) {
  const db = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("settle_credit_order", {
    p_token: DB_TOKEN,
    p_invoice: invoice,
    p_status: status,
    p_channel: channel,
    p_amount: amount,
  });
  if (error) throw new Error(`settle_credit_order: ${error.message}`);
  return data as string;
}

/**
 * Ask DOKU about a pending order and settle it when DOKU has an answer. A
 * backstop for a missed notification; the webhook is the normal path.
 */
export async function refreshOrder(order: CreditOrder): Promise<OrderStatus> {
  if (order.status !== "pending" || !paymentsEnabled) return order.status;
  const result = await checkStatus(order.invoice_number);
  if (result && result.status !== "PENDING") {
    return (await settleOrder(order.invoice_number, result.status, result.channel, result.amount)) as OrderStatus;
  }
  // Nothing paid and the payment window is long gone: close it.
  if (!result && Date.now() > new Date(order.pay_before).getTime() + 10 * 60_000) {
    return (await settleOrder(order.invoice_number, "EXPIRED", null, null)) as OrderStatus;
  }
  return "pending";
}

/** "QRIS", "VIRTUAL_ACCOUNT_BCA" → "VA BCA", "EMONEY_OVO" → "OVO". */
export function channelLabel(channel: string | null): string | null {
  if (!channel) return null;
  if (channel.startsWith("VIRTUAL_ACCOUNT_")) {
    return "VA " + channel.replace("VIRTUAL_ACCOUNT_", "").replace("BANK_", "").replace(/_/g, " ");
  }
  if (channel.startsWith("EMONEY_")) {
    const name = channel.replace("EMONEY_", "");
    return name === "SHOPEE_PAY" ? "ShopeePay" : name === "LINKAJA" ? "LinkAja" : name;
  }
  if (channel === "CREDIT_CARD") return "Card";
  return channel.replace(/_/g, " ");
}
