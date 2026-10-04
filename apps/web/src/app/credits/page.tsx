import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BuyCredits } from "@/components/BuyCredits";
import { InviteCard, type Invite } from "@/components/InviteCard";
import { LedgerList, type LedgerEntry, type PendingPurchase } from "@/components/LedgerList";
import { Icon } from "@/components/ui/Icon";
import { videoTime, type Pack } from "@/lib/credit-packs";
import { fill } from "@/lib/i18n/dictionaries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { channelLabel, paymentsEnabled } from "@/lib/payments";
import { getPricingSettings } from "@/lib/pricing";
import { currentCredits, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = Omit<LedgerEntry, "project_title" | "channel"> & {
  projects: { title: string | null } | null;
  credit_orders: { channel: string | null } | null;
};

/** Below this, the balance card nudges the user to top up. */
const LOW_BALANCE = 30;
const PAYMENT_METHODS = ["QRIS", "VA BCA", "VA Mandiri", "VA BRI", "VA BNI", "OVO", "DANA", "ShopeePay", "LinkAja"];
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default async function CreditsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/credits");
  const supabase = await createClient();
  const [t, locale, balanceOrNull, { data }, { data: packs }, { data: pending }, pricing, { data: referral }, h] =
    await Promise.all([
    getDictionary(),
    getLocale(),
    currentCredits(user),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, created_at, project_id, projects(title), credit_orders(channel)")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Row[]>(),
    supabase
      .from("credit_packs")
      .select("id, credits, price_idr, featured, discount_percent")
      .order("sort_order")
      .returns<Pack[]>(),
    supabase
      .from("credit_orders")
      .select("id, credits, payment_url")
      .eq("status", "pending")
      .gt("pay_before", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3)
      .returns<PendingPurchase[]>(),
    getPricingSettings(),
    supabase.rpc("my_referral"),
    headers(),
  ]);
  const invite = (referral as ({ enabled: boolean } & Partial<Invite>) | null)?.enabled
    ? (referral as Invite)
    : null;
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const balance = balanceOrNull ?? 0;
  const low = balance < LOW_BALANCE;
  const entries: LedgerEntry[] = (data ?? []).map(({ projects, credit_orders, ...e }) => ({
    ...e,
    project_title: projects?.title ?? null,
    channel: channelLabel(credit_orders?.channel ?? null),
  }));

  return (
    <AppShell user={user} title={t.creditsPage.title}>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Balance: compact row on phones, full card from medium up. */}
          <section className="flex items-center gap-3 rounded-lg bg-surface-container-low p-4 md:hidden">
            <Icon name="tollFill" size={28} className="shrink-0 text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-1.5">
                <span className="text-headline-m text-on-surface tabular-nums">{balance}</span>
                <span className="text-title-s text-on-surface-variant">{t.buy.credits}</span>
              </span>
              <span className="text-body-s text-on-surface-variant">{videoTime(balance, t)}</span>
            </span>
            {low && (
              <span className="shrink-0 rounded-[6px] bg-warning-container px-2 py-0.5 text-label-m text-on-warning-container">
                {t.buy.lowBalanceShort}
              </span>
            )}
          </section>
          <section className="hidden items-center gap-6 rounded-lg bg-surface-container-low p-6 md:flex">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label-l text-on-surface-variant">{t.buy.yourBalance}</span>
              <span className="flex items-center gap-2.5">
                <Icon name="tollFill" size={32} className="text-primary" />
                <span className="text-headline-l text-on-surface tabular-nums">{balance}</span>
                <span className="text-title-m text-on-surface-variant">{t.buy.credits}</span>
              </span>
              <p className="text-body-m text-on-surface-variant">{fill(t.buy.enoughFor, { n: balance })}</p>
            </div>
            {low && (
              <span className="flex shrink-0 items-center gap-2 rounded-md bg-warning-container py-2.5 pr-4 pl-3 text-label-l text-on-warning-container">
                <Icon name="info" size={20} />
                {t.buy.lowBalance}
              </span>
            )}
          </section>

          {!paymentsEnabled && (
            <p className="flex items-center gap-2 rounded-md bg-surface-container px-4 py-3 text-body-m text-on-surface-variant">
              <Icon name="info" size={20} className="shrink-0" />
              {t.buy.disabled}
            </p>
          )}

          <BuyCredits packs={packs ?? []} discountUntil={pricing.discount_until} t={t} locale={locale} />

          <section className="hidden flex-col gap-3 rounded-lg bg-surface-container-low px-6 py-5 md:flex">
            <h2 className="text-title-s text-on-surface">{t.buy.payWith}</h2>
            <ul className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <li
                  key={m}
                  className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-label-l text-on-surface"
                >
                  {m}
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-body-s text-on-surface-variant">
              <Icon name="info" size={16} className="mt-px shrink-0" />
              {t.buy.methodsNote}
            </p>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {invite && <InviteCard invite={invite} link={`${site}/r/${invite.code}`} t={t} />}
          <LedgerList entries={entries} t={t} locale={locale} pending={pending ?? []} />
          {CONTACT && (
            <p className="flex items-start gap-2 rounded-md bg-surface-container px-4 py-3 text-body-s text-on-surface-variant">
              <Icon name="info" size={16} className="mt-px shrink-0" />
              <span>
                {t.buy.help.split("{email}")[0]}
                <a href={`mailto:${CONTACT}`} className="text-primary underline">
                  {CONTACT}
                </a>
                {t.buy.help.split("{email}")[1]}
              </span>
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
