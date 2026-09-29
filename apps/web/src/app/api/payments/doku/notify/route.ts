import { NextResponse } from "next/server";
import { verifyNotification, type DokuStatus } from "@/lib/doku";
import { paymentsEnabled, settleOrder } from "@/lib/payments";

/**
 * DOKU's HTTP notification for a Checkout payment. Anything but a 2xx makes
 * DOKU retry (30 minutes, 6 hours, 12 hours later), so only a failure on our
 * side answers 5xx.
 */
export async function POST(request: Request) {
  if (!paymentsEnabled) return NextResponse.json({ error: "payments disabled" }, { status: 503 });
  const raw = await request.text();
  if (!verifyNotification(request.headers, raw)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: {
    order?: { invoice_number?: string; amount?: number | string };
    transaction?: { status?: string };
    channel?: { id?: string };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const invoice = body.order?.invoice_number;
  const status = body.transaction?.status;
  if (!invoice || !status) return NextResponse.json({ ok: true, ignored: true });
  if (!["SUCCESS", "FAILED", "EXPIRED"].includes(status)) return NextResponse.json({ ok: true, ignored: true });
  try {
    const result = await settleOrder(
      invoice,
      status as DokuStatus,
      body.channel?.id ?? null,
      body.order?.amount != null ? Number(body.order.amount) : null,
    );
    return NextResponse.json({ ok: true, status: result });
  } catch (e) {
    console.error("doku notify", invoice, e);
    return NextResponse.json({ error: "settle failed" }, { status: 500 });
  }
}
