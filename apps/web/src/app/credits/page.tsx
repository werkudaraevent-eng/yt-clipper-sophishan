import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LedgerList, type LedgerEntry } from "@/components/LedgerList";
import { Icon } from "@/components/ui/Icon";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentCredits, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = Omit<LedgerEntry, "project_title"> & { projects: { title: string | null } | null };

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
      .returns<Row[]>(),
  ]);
  const entries: LedgerEntry[] = (data ?? []).map(({ projects, ...e }) => ({
    ...e,
    project_title: projects?.title ?? null,
  }));

  return (
    <AppShell user={user} title={t.creditsPage.title}>
      <section className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-5 sm:p-6">
        <span className="text-label-l text-on-surface-variant">{t.creditsPage.balance}</span>
        <span className="flex items-center gap-3 text-display-s text-on-surface tabular-nums">
          <Icon name="tollFill" size={36} className="text-primary" />
          {balance ?? 0}
          <span className="text-title-m text-on-surface-variant">{t.header.credits}</span>
        </span>
        <p className="text-body-m text-on-surface-variant">{t.creditsPage.rule}</p>
      </section>
      <LedgerList entries={entries} t={t} locale={locale} />
    </AppShell>
  );
}
