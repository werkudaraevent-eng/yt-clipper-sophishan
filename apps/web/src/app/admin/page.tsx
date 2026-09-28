import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/ui/Icon";
import { fill } from "@/lib/i18n/dictionaries";
import { getDictionary } from "@/lib/i18n/server";
import { currentIsAdmin, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { adjustCredits } from "./actions";
import { AmountField } from "./amount-field";

type FoundUser = {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  credits_remaining: number;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; balance?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await currentIsAdmin(user))) notFound();

  const { email = "", balance, error } = await searchParams;
  const t = await getDictionary();
  const errors = t.admin.errors;

  let found: FoundUser | null = null;
  if (email) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_find_user", { target_email: email });
    found = (data as FoundUser[] | null)?.[0] ?? null;
  }

  const initials = (found?.display_name || found?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <AppShell user={user} title={t.admin.title}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
        <form className="flex flex-col gap-3 sm:relative">
          <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-4 focus-within:ring-2 focus-within:ring-primary sm:pr-36">
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
          <button className="btn-primary h-12 sm:absolute sm:top-1 sm:right-1">{t.admin.search}</button>
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

        {email && !found && (
          <p className="rounded-lg bg-surface-container-low px-4 py-10 text-center text-body-m text-on-surface-variant">
            {t.admin.notFound}
          </p>
        )}

        {found && (
          <section className="flex flex-col gap-6 rounded-lg bg-surface-container-low p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-title-m text-on-primary">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-title-l text-on-surface">{found.display_name ?? found.email}</p>
                <p className="truncate text-body-m text-on-surface-variant">{found.email}</p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-surface-container-lowest p-4">
                <dt className="text-label-m text-on-surface-variant">{t.admin.balance}</dt>
                <dd className="text-headline-m text-primary tabular-nums">{found.credits_remaining}</dd>
              </div>
              <div className="rounded-md bg-surface-container-lowest p-4">
                <dt className="text-label-m text-on-surface-variant">{t.admin.plan}</dt>
                <dd className="text-headline-m text-on-surface capitalize">{found.plan}</dd>
              </div>
            </dl>

            <form action={adjustCredits} className="flex flex-col gap-4">
              <input type="hidden" name="email" value={found.email} />
              <input type="hidden" name="userId" value={found.id} />
              <div>
                <h2 className="text-title-m text-on-surface">{t.admin.adjust}</h2>
                <p className="text-body-s text-on-surface-variant">{t.admin.adjustHint}</p>
              </div>
              <AmountField label={t.admin.amountShort} quickLabel={t.admin.quick} />
              <div className="relative">
                <input id="note" name="note" maxLength={200} placeholder={t.admin.notePlaceholder} className="input h-14" />
                <label
                  htmlFor="note"
                  className="pointer-events-none absolute -top-2 left-3 bg-surface-container-low px-1 text-body-s text-on-surface-variant"
                >
                  {t.admin.note}
                </label>
              </div>
              <button className="btn-primary h-12 self-start">
                <Icon name="check" size={18} />
                {t.admin.apply}
              </button>
            </form>
          </section>
        )}
      </div>
    </AppShell>
  );
}
