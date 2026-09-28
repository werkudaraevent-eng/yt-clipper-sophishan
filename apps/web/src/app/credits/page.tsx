import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/ui/Icon";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentCredits, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Entry = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  project_id: string | null;
  projects: { title: string | null } | null;
};

export default async function CreditsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/credits");
  const supabase = await createClient();
  const [t, locale, balance, { data }] = await Promise.all([
    getDictionary(),
    getLocale(),
    currentCredits(user),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, created_at, project_id, projects(title)")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Entry[]>(),
  ]);
  const r = t.creditsPage.reasons;
  const label = (e: Entry) => {
    if (e.reason === "signup_grant") return r.signup_grant;
    if (e.reason === "refund_failed") return r.refund_failed;
    if (e.reason === "project") return `${r.project}: ${e.projects?.title ?? t.projects.untitled}`;
    // "admin: <note> (by <uuid>)" from admin_adjust_credits; keep only the note.
    const note = e.reason.replace(/^admin:\s*/, "").replace(/\s*\(by [0-9a-f-]+\)$/, "");
    return note && note !== "adjustment" ? `${r.admin}: ${note}` : r.admin;
  };
  const when = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <AppShell user={user} title={t.creditsPage.title}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
        <section className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-6">
          <span className="text-label-l text-on-surface-variant">{t.creditsPage.balance}</span>
          <span className="flex items-center gap-3 text-display-s text-on-surface">
            <Icon name="tollFill" size={36} className="text-primary" />
            {balance ?? 0}
            <span className="text-title-m text-on-surface-variant">{t.header.credits}</span>
          </span>
          <p className="text-body-m text-on-surface-variant">{t.creditsPage.rule}</p>
        </section>

        <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
          <h2 className="px-5 pt-4 pb-2 text-title-m text-on-surface">{t.creditsPage.history}</h2>
          {!data?.length && (
            <p className="px-5 pb-6 text-body-m text-on-surface-variant">{t.creditsPage.empty}</p>
          )}
          <ul>
            {data?.map((e) => {
              const plus = e.delta > 0;
              const body = (
                <>
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      plus ? "bg-success-container text-on-success-container" : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    <Icon name={plus ? "add" : "movie"} size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-l text-on-surface">{label(e)}</span>
                    <span className="text-body-s text-on-surface-variant">{when.format(new Date(e.created_at))}</span>
                  </span>
                  <span className={`text-title-m ${plus ? "text-success" : "text-on-surface"}`}>
                    {plus ? `+${e.delta}` : `−${Math.abs(e.delta)}`}
                  </span>
                </>
              );
              return (
                <li key={e.id}>
                  {e.project_id ? (
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
      </div>
    </AppShell>
  );
}
