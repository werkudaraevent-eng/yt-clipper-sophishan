import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { Icon } from "./ui/Icon";

export type LedgerEntry = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  project_id: string | null;
  project_title: string | null;
};

function label(e: LedgerEntry, t: Dictionary) {
  const r = t.creditsPage.reasons;
  if (e.reason === "signup_grant") return r.signup_grant;
  if (e.reason === "refund_failed") return r.refund_failed;
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
}: {
  entries: LedgerEntry[];
  t: Dictionary;
  locale: string;
  /** Off on /admin: another user's projects are not readable by the admin's session. */
  linkProjects?: boolean;
}) {
  const when = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <h2 className="px-5 pt-4 pb-2 text-title-m text-on-surface">{t.creditsPage.history}</h2>
      {!entries.length && <p className="px-5 pb-6 text-body-m text-on-surface-variant">{t.creditsPage.empty}</p>}
      <ul className="pb-2">
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
                <Icon name={plus ? "add" : "movie"} size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-l text-on-surface">{label(e, t)}</span>
                <span className="text-body-s text-on-surface-variant">{when.format(new Date(e.created_at))}</span>
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
