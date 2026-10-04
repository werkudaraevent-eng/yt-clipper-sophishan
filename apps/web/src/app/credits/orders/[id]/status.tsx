"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import type { OrderStatus } from "@/lib/payments";
import { buyCredits, cancelOrder } from "../../actions";

type View = {
  id: string;
  packId: string;
  status: OrderStatus;
  credits: string;
  invoice: string;
  pack: string;
  total: string;
  payBefore: string;
  payBeforeLabel: string;
  method: string | null;
  paidAt: string | null;
  paymentUrl: string | null;
};

const FILLED_M =
  "state-layer focus-ring inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-title-m text-on-primary disabled:bg-on-surface/12 disabled:text-on-surface/38";
const TEXT_S =
  "state-layer focus-ring inline-flex h-10 w-full items-center justify-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38";

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Waiting, paid, or not paid: one screen per state, following the order live. */
export function OrderStatusView({
  order,
  balance,
  t,
}: {
  order: View;
  balance: number;
  t: Dictionary;
  locale: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = order.status === "pending";

  // While waiting: tick the countdown every second, ask for news every 5.
  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const res = await fetch(`/api/credits/orders/${order.id}`, { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? ((await res.json()) as { status: OrderStatus }) : null;
      if (data && data.status !== "pending") router.refresh();
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pending, order.id, router]);

  async function retry() {
    setBusy(true);
    setError(null);
    const result = await buyCredits(order.packId);
    if ("url" in result) return window.location.assign(result.url);
    // Retrying is without a promo code, so only the plain errors come back.
    setError(t.buy.errors["error" in result ? result.error : "failed"]);
    setBusy(false);
  }

  async function cancel() {
    setBusy(true);
    await cancelOrder(order.id);
    router.refresh();
    setBusy(false);
  }

  let icon: IconName, tone: string, title: string, body: string, rows: [string, string, boolean?][];
  if (order.status === "paid") {
    icon = "checkCircle";
    tone = "bg-success-container text-on-success-container";
    title = t.order.paidTitle;
    body = fill(t.order.paidBody, { n: order.credits, balance });
    rows = [
      [t.order.invoice, order.invoice],
      ...(order.method ? [[t.order.method, order.method] as [string, string]] : []),
      [t.order.total, order.total],
      ...(order.paidAt ? [[t.order.time, order.paidAt] as [string, string]] : []),
    ];
  } else if (pending) {
    icon = "hourglass";
    tone = "bg-warning-container text-on-warning-container";
    title = t.order.waitingTitle;
    body = t.order.waitingBody;
    rows = [
      [t.order.invoice, order.invoice],
      [t.order.pack, order.pack],
      [t.order.total, order.total],
      [t.order.payBefore, order.payBeforeLabel],
    ];
  } else {
    const s = order.status as "failed" | "expired" | "cancelled";
    icon = "error";
    tone = "bg-error-container text-on-error-container";
    title = t.order.failedTitle;
    body = fill(
      s === "expired" ? t.order.expiredBody : s === "cancelled" ? t.order.cancelledBody : t.order.failedBody,
      { balance },
    );
    rows = [
      [t.order.invoice, order.invoice],
      [t.order.pack, order.pack],
      [t.order.status, t.order.statuses[s], true],
    ];
  }

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-6 pt-4">
      <div className="flex w-full flex-col items-center gap-3 text-center">
        <span className={`flex h-18 w-18 items-center justify-center rounded-full ${tone}`}>
          <Icon name={icon} size={36} />
        </span>
        {order.status === "paid" && (
          <span className="rounded-full bg-success-container px-3 py-1 text-label-l text-on-success-container">
            {fill(t.order.plus, { n: order.credits })}
          </span>
        )}
        <h2 className="text-headline-s text-on-surface">{title}</h2>
        <p className="text-body-m text-on-surface-variant">{body}</p>
        {pending && (
          <span className="flex items-center gap-1.5 rounded-full bg-warning-container py-1.5 pr-3.5 pl-3 text-label-l text-on-warning-container">
            <Icon name="schedule" size={16} />
            {fill(t.order.timeLeft, { t: mmss(new Date(order.payBefore).getTime() - now) })}
          </span>
        )}
      </div>

      <dl className="w-full rounded-lg bg-surface-container-low px-4 py-2">
        {rows.map(([k, v, bad]) => (
          <div key={k} className="flex items-center gap-3 py-2.5">
            <dt className="flex-1 text-body-m text-on-surface-variant">{k}</dt>
            <dd className={`text-title-s ${bad ? "text-error" : "text-on-surface"}`}>{v}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-body-m text-error">
          <Icon name="error" size={18} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="flex w-full flex-col gap-2">
        {order.status === "paid" ? (
          <>
            <Link href="/#create" className={FILLED_M}>
              <Icon name="wand" />
              {t.order.createClip}
            </Link>
            <Link href="/credits" className="btn-secondary w-full">
              {t.order.history}
            </Link>
          </>
        ) : pending ? (
          <>
            {order.paymentUrl && (
              <a href={order.paymentUrl} className={FILLED_M}>
                {t.order.continue}
              </a>
            )}
            <button type="button" onClick={cancel} disabled={busy} className={TEXT_S}>
              {t.order.cancelOrder}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={retry} disabled={busy} className={FILLED_M}>
              <Icon name="refresh" />
              {busy ? t.buy.opening : t.order.retry}
            </button>
            <Link href="/credits" className={TEXT_S}>
              {t.order.otherPack}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
