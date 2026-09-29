import { NextResponse } from "next/server";
import { ORDER_COLUMNS, refreshOrder, type CreditOrder } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's order, checked with DOKU while it is still pending. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("credit_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle<CreditOrder>();
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  let status = order.status;
  try {
    status = await refreshOrder(order);
  } catch (e) {
    console.error("order refresh", order.invoice_number, e);
  }
  return NextResponse.json({ status });
}
