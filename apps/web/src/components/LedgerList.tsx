import Link from "next/link";
import { hhmm, shortDate } from "@/lib/format";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { Icon } from "./ui/Icon";

export type LedgerEntry = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  project_id: string | null;
  project_title: string | null;
  /** Payment channel of a purchase, already readable ("QRIS", "VA BCA"). */
  channel?: string | null;
};

/** A purchase still waiting for payment, shown above the history. */
export type PendingPurchase = { id: string; credits: number; payment_url: string | null };

function label(e: LedgerEntry, t: Dictionary) {
  const r = t.creditsPage.reasons;
  if (e.reason === "signup_grant") return r.signup_grant;
  if (e.reason === "refund_failed") return r.refund_failed;
  if (e.reason === "referral_reward") return r.referral_reward;
  if (e.reason === "referral_bonus") return r.referral_bonus;
  if (e.reason === "purchase") return fill(r.purchase, { n: e.delta });
  if (e.reason === "project") return `${r.project}: ${e.project_title ?? t.projects.untitled}`;
  // "admin: <note> (by <uuid>)" from admin_adjust_credits; keep only the note.
  const note = e.reason.replace(/^admin:\s*/, "").replace(/\s*\(by [0-9a-f-]+\)$/, "");
  return note && note !== "adjustment" ? `${r.admin}: ${note}` : r.admin;
}

/** Credit history as an M3 list in an outlined card. */
export function LedgerList({
  entries,
  t,
  locale,
  linkProjects = true,
  pending = [],
}: {
  entries: LedgerEntry[];
  t: Dictionary;
  locale: string;
  /** Off on /admin: another user's projects are not readable by the admin's session. */
  linkProjects?: boolean;
  pending?: PendingPurchase[];
}) {
  // "Hari ini 09:15 · QRIS"
  const when = (e: LedgerEntry) =>
    [`${shortDate(e.created_at, locale)} ${hhmm(e.created_at)}`, e.channel]
      .filter(Boolean)
      .join(" · ");
  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <h2 className="px-5 pt-4 pb-2 text-title-m text-on-surface">{t.creditsPage.history}</h2>
      {!entries.length && !pending.length && <p className="px-5 pb-6 text-body-m text-on-surface-variant">{t.creditsPage.empty}</p>}
      <ul className="pb-2">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-4 px-5 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-container text-on-warning-container">
              <Icon name="hourglass" size={20} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-l text-on-surface">{fill(t.creditsPage.reasons.purchase, { n: p.credits })}</span>
              <span className="text-body-s text-on-surface-variant">{t.buy.pending}</span>
            </span>
            <Link
              href={p.payment_url ?? `/credits/orders/${p.id}`}
              className="state-layer focus-ring -mr-3 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-label-l text-primary"
            >
              {t.buy.pay}
            </Link>
          </li>
        ))}
        {entries.map((e) => {
          const plus = e.delta > 0;
          const body = (
            <>
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  plus
                    ? "bg-success-container text-on-success-container"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                <Icon name={e.reason === "purchase" ? "tollFill" : plus ? "add" : "movie"} size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-l text-on-surface">{label(e, t)}</span>
                <span className="text-body-s text-on-surface-variant">{when(e)}</span>
              </span>
              <span className={`shrink-0 text-title-m tabular-nums ${plus ? "text-success" : "text-on-surface"}`}>
                {plus ? `+${e.delta}` : `−${Math.abs(e.delta)}`}
              </span>
            </>
          );
          return (
            <li key={e.id}>
              {e.project_id && linkProjects ? (
                <Link href={`/projects/${e.project_id}`} className="state-layer flex items-center gap-4 px-5 py-3">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-4 px-5 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
