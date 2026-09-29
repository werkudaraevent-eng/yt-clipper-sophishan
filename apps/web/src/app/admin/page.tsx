import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LedgerList, type LedgerEntry } from "@/components/LedgerList";
import { Icon } from "@/components/ui/Icon";
import { shortDate } from "@/lib/format";
import { type Dictionary, fill } from "@/lib/i18n/dictionaries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentIsAdmin, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { setRole } from "./actions";
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

type Role = "user" | "admin" | "owner";
type RecentUser = FoundUser & {
  role: Role;
  created_at: string;
  projects: number;
};
type StaffMember = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
};

function initialsOf(name: string | null | undefined, email: string) {
  return (name || email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Avatar({ text, size = "h-10 w-10 text-title-s" }: { text: string; size?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container ${size}`}
    >
      {text}
    </span>
  );
}

function RoleBadge({ role, label }: { role: Role; label: string }) {
  if (role === "user") return null;
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-label-m ${
        role === "owner"
          ? "bg-tertiary-container text-on-tertiary-container"
          : "bg-secondary-container text-on-secondary-container"
      }`}
    >
      {label}
    </span>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    email?: string;
    balance?: string;
    error?: string;
    added?: string;
    removed?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await currentIsAdmin(user))) notFound();

  const { tab, email = "", balance, error, added, removed } = await searchParams;
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const errors = t.admin.errors;
  const team = tab === "team";

  const tabs = (
    <nav role="tablist" aria-label={t.admin.title} className="-mt-2 flex border-b border-outline-variant">
      {(
        [
          ["users", "/admin", "person", t.admin.tabs.users],
          ["team", "/admin?tab=team", "admin", t.admin.tabs.team],
        ] as const
      ).map(([key, href, icon, label]) => {
        const active = team === (key === "team");
        return (
          <Link
            key={key}
            href={href}
            role="tab"
            aria-selected={active}
            className={`state-layer focus-ring relative flex h-12 flex-1 items-center justify-center gap-2 px-4 text-title-s sm:flex-none sm:px-6 ${
              active ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            <Icon name={icon} size={20} />
            {label}
            {active && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );

  if (team) {
    return (
      <AppShell user={user} title={t.admin.title}>
        {tabs}
        <TeamTab t={t} added={added} removed={removed} error={error} />
      </AppShell>
    );
  }

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

  let recent: RecentUser[] = [];
  if (!email) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_recent_users", { max_rows: 20 });
    recent = (data as RecentUser[] | null) ?? [];
  }

  const initials = initialsOf(found?.display_name, found?.email ?? "");
  const joined = overview?.created_at
    ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { dateStyle: "medium" }).format(
        new Date(overview.created_at),
      )
    : null;

  return (
    <AppShell user={user} title={t.admin.title}>
      {tabs}
      <form action="/admin" className="flex flex-col gap-3 sm:relative">
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

      {email && (
        <Link
          href="/admin"
          className="state-layer focus-ring -my-2 inline-flex h-10 items-center gap-2 self-start rounded-full px-3 text-label-l text-primary"
        >
          <Icon name="arrowBack" size={20} />
          {t.admin.allUsers}
        </Link>
      )}

      {!email && (
        <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
          <h2 className="px-5 pt-4 pb-1 text-title-m text-on-surface">{t.admin.recent}</h2>
          <p className="px-5 pb-2 text-body-s text-on-surface-variant">{t.admin.hint}</p>
          {!recent.length && <p className="px-5 pb-6 text-body-m text-on-surface-variant">{t.admin.recentEmpty}</p>}
          <ul className="pb-2">
            {recent.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/admin?${new URLSearchParams({ email: u.email })}`}
                  className="state-layer flex items-center gap-4 px-5 py-3"
                >
                  <Avatar text={initialsOf(u.display_name, u.email)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-body-l text-on-surface">{u.display_name ?? u.email}</span>
                      <RoleBadge role={u.role} label={t.admin.roles[u.role]} />
                    </span>
                    <span className="truncate text-body-s text-on-surface-variant">
                      {u.email} · {shortDate(u.created_at, locale)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-title-m text-primary tabular-nums">{u.credits_remaining}</span>
                    <span className="text-body-s text-on-surface-variant">
                      {fill(t.admin.projectCount, { n: String(u.projects) })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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

/** Owners and admins; the owner can add an admin by email and remove admins. */
async function TeamTab({
  t,
  added,
  removed,
  error,
}: {
  t: Dictionary;
  added?: string;
  removed?: string;
  error?: string;
}) {
  const supabase = await createClient();
  const [{ data: staffData }, { data: owner }] = await Promise.all([
    supabase.rpc("admin_list_staff"),
    supabase.rpc("is_owner"),
  ]);
  const staff = (staffData as StaffMember[] | null) ?? [];
  const isOwner = owner === true;
  const errors = t.admin.team.errors;
  const done = added
    ? fill(t.admin.team.added, { email: added })
    : removed
      ? fill(t.admin.team.removed, { email: removed })
      : null;

  return (
    <>
      {done && (
        <p role="status" className="flex gap-2 rounded-md bg-success-container p-3 text-body-m text-on-success-container">
          <Icon name="checkCircle" size={20} className="shrink-0" />
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
          <Icon name="error" size={20} className="shrink-0" />
          {errors[error as keyof typeof errors] ?? errors.failed}
        </p>
      )}

      {isOwner && (
        <form action={setRole} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <input type="hidden" name="role" value="admin" />
          <div className="relative flex-1">
            <input id="staff-email" name="email" type="email" required className="input h-14" />
            <label
              htmlFor="staff-email"
              className="pointer-events-none absolute -top-2 left-3 bg-surface px-1 text-body-s text-on-surface-variant"
            >
              {t.admin.team.addLabel}
            </label>
          </div>
          <button className="btn-primary h-14 px-8">
            <Icon name="add" size={20} />
            {t.admin.team.add}
          </button>
        </form>
      )}

      <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <h2 className="px-5 pt-4 pb-1 text-title-m text-on-surface">{t.admin.tabs.team}</h2>
        <p className="px-5 pb-2 text-body-s text-on-surface-variant">{t.admin.team.hint}</p>
        <ul className="pb-2">
          {staff.map((m) => (
            <li key={m.id} className="flex items-center gap-4 px-5 py-3">
              <Avatar text={initialsOf(m.display_name, m.email)} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-l text-on-surface">{m.display_name ?? m.email}</span>
                <span className="truncate text-body-s text-on-surface-variant">{m.email}</span>
              </span>
              <RoleBadge role={m.role} label={t.admin.roles[m.role]} />
              {isOwner && m.role === "admin" && (
                <form action={setRole}>
                  <input type="hidden" name="email" value={m.email} />
                  <input type="hidden" name="role" value="user" />
                  <button className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-error">
                    {t.admin.team.remove}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
