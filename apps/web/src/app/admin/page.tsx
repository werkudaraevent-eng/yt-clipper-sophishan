import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LedgerList, type LedgerEntry } from "@/components/LedgerList";
import { Icon } from "@/components/ui/Icon";
import { fill } from "@/lib/i18n/dictionaries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentIsAdmin, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AdjustForm } from "./adjust-form";

type FoundUser = {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  credits_remaining: number;
};

/** From admin_user_overview; null until that migration is applied. */
type Overview = { created_at: string | null; projects: number; ledger: LedgerEntry[] };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; balance?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await currentIsAdmin(user))) notFound();

  const { email = "", balance, error } = await searchParams;
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const errors = t.admin.errors;

  let found: FoundUser | null = null;
  if (email) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_find_user", { target_email: email });
    found = (data as FoundUser[] | null)?.[0] ?? null;
  }

  let overview: Overview | null = null;
  if (found) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_user_overview", { target_user: found.id });
    overview = (data as Overview | null) ?? null;
  }

  const initials = (found?.display_name || found?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const joined = overview?.created_at
    ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { dateStyle: "medium" }).format(
        new Date(overview.created_at),
      )
    : null;

  return (
    <AppShell user={user} title={t.admin.title}>
      <form className="flex flex-col gap-3 sm:relative">
        <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-5 focus-within:ring-2 focus-within:ring-primary sm:h-16 sm:pr-40">
          <Icon name="search" className="shrink-0 text-on-surface-variant" />
          <span className="sr-only">{t.admin.searchLabel}</span>
          <input
            name="email"
            type="email"
            required
            defaultValue={email}
            placeholder={t.admin.searchLabel}
            className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface outline-none placeholder:text-on-surface-variant"
          />
        </label>
        <button className="btn-primary h-12 sm:absolute sm:top-2 sm:right-2">{t.admin.search}</button>
      </form>

      {balance && (
        <p role="status" className="flex gap-2 rounded-md bg-success-container p-3 text-body-m text-on-success-container">
          <Icon name="checkCircle" size={20} className="shrink-0" />
          {fill(t.admin.done, { balance })}
        </p>
      )}
      {error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
          <Icon name="error" size={20} className="shrink-0" />
          {errors[error as keyof typeof errors] ?? errors.failed}
        </p>
      )}

      {!email && (
        <p className="flex flex-col items-center gap-2 rounded-lg bg-surface-container-low px-4 py-12 text-center text-body-m text-on-surface-variant">
          <Icon name="person" size={32} />
          {t.admin.hint}
        </p>
      )}
      {email && !found && (
        <p className="rounded-lg bg-surface-container-low px-4 py-10 text-center text-body-m text-on-surface-variant">
          {t.admin.notFound}
        </p>
      )}

      {found && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
          <section className="flex flex-col gap-6 rounded-lg bg-surface-container-low p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-title-l text-on-primary">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-title-l text-on-surface">{found.display_name ?? found.email}</p>
                <p className="truncate text-body-m text-on-surface-variant">
                  {found.email}
                  {joined && ` · ${fill(t.admin.joined, { date: joined })}`}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-3">
              {[
                [t.admin.balance, found.credits_remaining, "text-primary"],
                [t.admin.plan, found.plan, "capitalize text-on-surface"],
                [t.admin.projects, overview?.projects ?? "–", "text-on-surface"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-md bg-surface-container-lowest p-4">
                  <dt className="text-label-m text-on-surface-variant">{label}</dt>
                  <dd className={`text-headline-m tabular-nums ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-title-m text-on-surface">{t.admin.adjust}</h2>
                <p className="text-body-s text-on-surface-variant">{t.admin.adjustHint}</p>
              </div>
              <AdjustForm
                email={found.email}
                userId={found.id}
                labels={{
                  amount: t.admin.amountShort,
                  note: t.admin.note,
                  notePlaceholder: t.admin.notePlaceholder,
                  apply: t.admin.apply,
                  quick: t.admin.quick,
                }}
              />
            </div>
          </section>

          {overview && <LedgerList entries={overview.ledger} t={t} locale={locale} linkProjects={false} />}
        </div>
      )}
    </AppShell>
  );
}
