"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { PackCards } from "@/components/BuyCredits";
import { Segmented, Switch } from "@/components/controls";
import { Icon } from "@/components/ui/Icon";
import { count, packMath, rupiah, salePrice, type Pack } from "@/lib/credit-packs";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import type { PricingSettings } from "@/lib/pricing";
import {
  type PackInput,
  type PricingError,
  type PromoInput,
  savePricing,
  savePromo,
  setPromoActive,
} from "./actions";

export type DbPack = Pack & { active: boolean; sort_order: number };
export type DbPromo = Omit<PromoInput, "id"> & { id: string; uses: number };
export type PricingData = {
  packs: DbPack[];
  settings: PricingSettings;
  promos: DbPromo[];
  referrals: { invited: number; bought: number; credits: number };
};

/** A pack row while editing: numbers as digit strings so fields can be empty. */
type Draft = {
  key: string;
  id: string | null;
  credits: string;
  price: string;
  discount: string;
  featured: boolean;
  active: boolean;
};

type SettingsDraft = {
  signup: string;
  until: string;
  referral: boolean;
  reward: string;
  bonus: string;
};

const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 9);
const num = (v: string) => Number(v || 0);
const grouped = (v: string) => (v ? new Intl.NumberFormat("id-ID").format(Number(v)) : "");

/** ISO time → the value a datetime-local input shows, in the browser's time zone. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const toDrafts = (packs: DbPack[]): Draft[] =>
  packs.map((p) => ({
    key: p.id,
    id: p.id,
    credits: String(p.credits),
    price: String(p.price_idr),
    discount: p.discount_percent ? String(p.discount_percent) : "",
    featured: p.featured,
    active: p.active,
  }));

const toSettingsDraft = (s: PricingSettings): SettingsDraft => ({
  signup: String(s.signup_credits),
  until: toLocalInput(s.discount_until),
  referral: s.referral_enabled,
  reward: String(s.referral_reward),
  bonus: String(s.referral_signup_bonus),
});

const asPack = (d: Draft): Pack => ({
  id: d.key,
  credits: num(d.credits),
  price_idr: num(d.price),
  featured: d.featured,
  discount_percent: Math.min(num(d.discount), 90),
});

/** Outlined text field; the floating label sits on the border like the design's. */
function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
  disabled,
  ariaLabel,
  type = "text",
  className = "",
  bg = "bg-surface-container-lowest",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
  type?: "text" | "datetime-local";
  className?: string;
  bg?: string;
}) {
  return (
    <label className={`relative flex h-14 items-center gap-1 rounded-xs border border-outline px-4 focus-within:border-2 focus-within:border-primary focus-within:px-[15px] ${disabled ? "border-transparent px-0 focus-within:px-0" : ""} ${className}`}>
      {label && (
        <span className={`pointer-events-none absolute -top-2 left-3 px-1 text-body-s text-on-surface-variant ${bg}`}>
          {label}
        </span>
      )}
      {prefix && <span className="text-body-l text-on-surface-variant">{prefix}</span>}
      <input
        type={type}
        inputMode={type === "text" ? "numeric" : undefined}
        aria-label={ariaLabel ?? label}
        value={type === "text" ? grouped(value) : value}
        onChange={(e) => onChange(type === "text" ? digits(e.target.value) : e.target.value)}
        disabled={disabled}
        placeholder={type === "text" ? "0" : undefined}
        className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface tabular-nums outline-none placeholder:text-on-surface-variant disabled:text-on-surface"
      />
      {suffix && <span className="text-body-l text-on-surface-variant">{suffix}</span>}
    </label>
  );
}

function Card({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-start gap-4 px-5 pt-4 pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-title-m text-on-surface">{title}</h2>
          <p className="text-body-s text-on-surface-variant">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Radio({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-38"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? "border-primary" : "border-on-surface-variant"}`}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
    </button>
  );
}

function Chip({ children, tone = "success" }: { children: ReactNode; tone?: "success" | "error" }) {
  return (
    <span
      className={`inline-flex rounded-sm px-2 py-1 text-label-m whitespace-nowrap ${
        tone === "success" ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"
      }`}
    >
      {children}
    </span>
  );
}

/** The Pricing tab on /admin: packs and discounts, sign-up credits, referrals and promo codes. */
export function PricingForm({
  data,
  isOwner,
  t,
  locale,
}: {
  data: PricingData;
  isOwner: boolean;
  t: Dictionary;
  locale: string;
}) {
  const p = t.admin.pricing;
  const router = useRouter();
  const [drafts, setDrafts] = useState(() => toDrafts(data.packs));
  const [settings, setSettings] = useState(() => toSettingsDraft(data.settings));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<DbPromo | "new" | null>(null);
  const readOnly = !isOwner;

  // After a save the server data changes; start editing from it again.
  useEffect(() => {
    setDrafts(toDrafts(data.packs));
    setSettings(toSettingsDraft(data.settings));
  }, [data]);

  const dirty =
    JSON.stringify(drafts) !== JSON.stringify(toDrafts(data.packs)) ||
    JSON.stringify(settings) !== JSON.stringify(toSettingsDraft(data.settings));
  const until = fromLocalInput(settings.until);
  const previewPacks = useMemo(() => drafts.filter((d) => d.active && num(d.credits) > 0).map(asPack), [drafts]);
  const allPacks = drafts.map(asPack);

  const update = (key: string, change: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...change } : change.featured ? { ...d, featured: false } : d)));

  function addPack() {
    const key = `new-${Date.now()}`;
    setDrafts((ds) => [...ds, { key, id: null, credits: "", price: "", discount: "", featured: false, active: true }]);
  }

  const errorText = (e: PricingError) => p.errors[e] ?? p.errors.failed;

  async function save() {
    setBusy(true);
    setMessage(null);
    const packs: PackInput[] = drafts
      .filter((d) => d.id || num(d.credits) > 0)
      .map((d) => ({
        id: d.id,
        credits: num(d.credits),
        price_idr: num(d.price),
        discount_percent: Math.min(num(d.discount), 90),
        featured: d.featured,
        active: d.active,
      }));
    const result = await savePricing(packs, {
      signup_credits: num(settings.signup),
      discount_until: until,
      referral_enabled: settings.referral,
      referral_reward: num(settings.reward),
      referral_signup_bonus: num(settings.bonus),
    });
    setBusy(false);
    setMessage("ok" in result ? { ok: true, text: p.saved } : { ok: false, text: errorText(result.error) });
    if ("ok" in result) router.refresh();
  }

  function reset() {
    setDrafts(toDrafts(data.packs));
    setSettings(toSettingsDraft(data.settings));
    setMessage(null);
  }

  async function togglePromo(promo: DbPromo, active: boolean) {
    const result = await setPromoActive(promo.id, active);
    if ("error" in result) setMessage({ ok: false, text: errorText(result.error) });
    router.refresh();
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { dateStyle: "medium" }).format(new Date(iso));
  const packName = (id: string | null) => {
    const pack = data.packs.find((x) => x.id === id);
    return pack ? `${count(pack.credits, locale)} ${p.creditsUnit}` : p.anyPack;
  };

  return (
    <>
      <p className="flex items-center gap-3 rounded-md bg-surface-container-low px-4 py-3 text-body-m text-on-surface-variant">
        <Icon name="info" size={20} className="shrink-0" />
        {readOnly ? p.readOnly : p.info}
      </p>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex gap-2 rounded-md p-3 text-body-m ${
            message.ok ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"
          }`}
        >
          <Icon name={message.ok ? "checkCircle" : "error"} size={20} className="shrink-0" />
          {message.text}
        </p>
      )}

      {/* Packs */}
      <Card title={p.packsTitle} hint={p.packsHint}>
        <div className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
          <Field
            type="datetime-local"
            label={p.discountUntil}
            value={settings.until}
            onChange={(v) => setSettings((s) => ({ ...s, until: v }))}
            disabled={readOnly}
            className="sm:w-[260px] sm:shrink-0"
          />
          <p className="text-body-s text-on-surface-variant">{p.discountUntilHint}</p>
        </div>
        <div className="hidden grid-cols-[120px_200px_110px_160px_110px_96px_72px_minmax(0,1fr)] gap-4 px-5 py-2 text-label-m text-on-surface-variant lg:grid">
          <span>{p.cols.credits}</span>
          <span>{p.cols.price}</span>
          <span>{p.cols.discount}</span>
          <span>{p.cols.sale}</span>
          <span>{p.cols.perCredit}</span>
          <span>{p.cols.featured}</span>
          <span>{p.cols.visible}</span>
        </div>
        <ul role="radiogroup" aria-label={p.cols.featured}>
          {drafts.map((d) => {
            const pack = asPack(d);
            const { price, perCredit, saving, discount } = packMath(pack, allPacks, until);
            const valid = pack.credits > 0 && pack.price_idr > 0;
            const credits = (
              <Field
                ariaLabel={p.cols.credits}
                value={d.credits}
                onChange={(v) => update(d.key, { credits: v })}
                disabled={readOnly}
              />
            );
            const priceField = (
              <Field
                ariaLabel={p.cols.price}
                prefix="Rp"
                value={d.price}
                onChange={(v) => update(d.key, { price: v })}
                disabled={readOnly}
              />
            );
            const discountField = (
              <Field
                ariaLabel={p.cols.discount}
                suffix="%"
                value={d.discount}
                onChange={(v) => update(d.key, { discount: v.slice(0, 2) })}
                disabled={readOnly}
              />
            );
            const sale = (
              <span className="flex flex-col">
                <span className={`text-title-m tabular-nums ${discount ? "text-primary" : "text-on-surface"}`}>
                  {valid ? rupiah(price) : "–"}
                </span>
                {discount && <s className="text-body-s text-on-surface-variant tabular-nums">{rupiah(pack.price_idr)}</s>}
              </span>
            );
            const per = (
              <span className="flex flex-col items-start gap-1">
                <span className="text-body-l text-on-surface tabular-nums">{valid ? rupiah(perCredit) : "–"}</span>
                {valid && saving && <Chip>{fill(t.buy.save, { n: saving })}</Chip>}
              </span>
            );
            const radio = (
              <Radio
                checked={d.featured}
                onChange={() => update(d.key, { featured: true })}
                label={`${p.cols.featured}: ${d.credits || "?"} ${p.creditsUnit}`}
                disabled={readOnly}
              />
            );
            const visible = (
              <Switch
                checked={d.active}
                onChange={(v) => update(d.key, { active: v })}
                label={`${p.cols.visible}: ${d.credits || "?"} ${p.creditsUnit}`}
                disabled={readOnly}
              />
            );
            const remove = !d.id && (
              <button
                type="button"
                onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-error"
              >
                {p.removePack}
              </button>
            );
            return (
              <li key={d.key} className="border-t border-outline-variant px-5 py-3">
                {/* Wide windows: one table row. */}
                <div className="hidden grid-cols-[120px_200px_110px_160px_110px_96px_72px_minmax(0,1fr)] items-center gap-4 lg:grid">
                  {credits}
                  {priceField}
                  {discountField}
                  {sale}
                  {per}
                  {radio}
                  {visible}
                  <span className="justify-self-end">{remove}</span>
                </div>
                {/* Narrow windows: a card per pack. */}
                <div className="flex flex-col gap-3 lg:hidden">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-title-m text-on-surface">
                      {d.credits ? count(num(d.credits), locale) : "–"} {p.creditsUnit}
                    </span>
                    {remove}
                    <span className="text-label-m text-on-surface-variant">{p.cols.visible}</span>
                    {visible}
                  </div>
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] gap-2">
                    {credits}
                    {priceField}
                    {discountField}
                  </div>
                  <div className="flex items-center gap-2 text-body-s text-on-surface-variant">
                    <span className="tabular-nums">
                      {valid && (discount ? rupiah(price) : fill(t.buy.perCredit, { price: rupiah(perCredit) }))}
                    </span>
                    {valid && discount ? (
                      <Chip>{fill(t.buy.discount, { n: discount })}</Chip>
                    ) : (
                      valid && saving && <Chip>{fill(t.buy.save, { n: saving })}</Chip>
                    )}
                    <span className="flex-1" />
                    <span className="text-label-m">{p.cols.featured}</span>
                    {radio}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!readOnly && (
          <div className="border-t border-outline-variant px-3 py-2">
            <button
              type="button"
              onClick={addPack}
              className="state-layer focus-ring inline-flex h-10 items-center gap-2 rounded-full px-3 text-label-l text-primary"
            >
              <Icon name="add" size={20} />
              {p.addPack}
            </button>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Sign-up credits */}
        <Card title={p.signupTitle} hint={p.signupHint}>
          <div className="flex flex-col gap-4 px-5 pt-3 pb-5">
            <Field
              label={p.signupAmount}
              suffix={p.creditsUnit}
              value={settings.signup}
              onChange={(v) => setSettings((s) => ({ ...s, signup: v.slice(0, 4) }))}
              disabled={readOnly}
              className="max-w-[220px]"
            />
            <div className="flex flex-col items-start gap-2 rounded-md bg-surface-container-low px-4 py-3">
              <span className="text-label-m text-on-surface-variant">{p.landingPreview}</span>
              <span className="inline-flex items-center gap-2 rounded-sm bg-secondary-container px-3 py-1 text-label-l text-on-secondary-container">
                <Icon name="wand" size={16} />
                {fill(t.landing.badge, { n: num(settings.signup) })}
              </span>
              <span className="text-body-s text-on-surface-variant">
                “{fill(t.home.freeNote, { n: num(settings.signup) })}”
              </span>
            </div>
          </div>
        </Card>

        {/* Referrals */}
        <Card
          title={p.referralTitle}
          hint={p.referralHint}
          action={
            <Switch
              checked={settings.referral}
              onChange={(v) => setSettings((s) => ({ ...s, referral: v }))}
              label={p.referralTitle}
              disabled={readOnly}
            />
          }
        >
          <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
            <div className="flex flex-col gap-1.5">
              <Field
                label={p.referralReward}
                suffix={p.creditsUnit}
                value={settings.reward}
                onChange={(v) => setSettings((s) => ({ ...s, reward: v.slice(0, 5) }))}
                disabled={readOnly}
                className="max-w-[220px]"
              />
              <p className="text-body-s text-on-surface-variant">{p.referralRewardHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Field
                label={p.referralBonus}
                suffix={p.creditsUnit}
                value={settings.bonus}
                onChange={(v) => setSettings((s) => ({ ...s, bonus: v.slice(0, 4) }))}
                disabled={readOnly}
                className="max-w-[220px]"
              />
              <p className="text-body-s text-on-surface-variant">{p.referralBonusHint}</p>
            </div>
            <dl className="grid grid-cols-3 gap-3">
              {(
                [
                  [data.referrals.invited, p.referralStats.invited],
                  [data.referrals.bought, p.referralStats.bought],
                  [data.referrals.credits, p.referralStats.credits],
                ] as const
              ).map(([n, label]) => (
                <div key={label} className="rounded-md bg-surface-container-low px-4 py-3">
                  <dd className="text-title-l text-on-surface tabular-nums">{count(n, locale)}</dd>
                  <dt className="text-body-s text-on-surface-variant">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>

      {/* Promo codes */}
      <Card
        title={p.promoTitle}
        hint={p.promoHint}
        action={
          !readOnly && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="state-layer focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-secondary-container px-4 text-label-l text-on-secondary-container"
            >
              <Icon name="add" size={20} />
              {p.newPromo}
            </button>
          )
        }
      >
        {!data.promos.length && <p className="px-5 pt-2 pb-5 text-body-m text-on-surface-variant">{p.noPromos}</p>}
        {data.promos.length > 0 && (
          <div className="hidden grid-cols-[180px_130px_150px_150px_170px_72px_minmax(0,1fr)] gap-4 px-5 py-2 text-label-m text-on-surface-variant lg:grid">
            <span>{p.promoCols.code}</span>
            <span>{p.promoCols.off}</span>
            <span>{p.promoCols.pack}</span>
            <span>{p.promoCols.used}</span>
            <span>{p.promoCols.until}</span>
            <span>{p.promoCols.active}</span>
          </div>
        )}
        <ul>
          {data.promos.map((c) => {
            const off = c.kind === "percent" ? `${c.value}%` : rupiah(c.value);
            const used = c.max_uses ? fill(p.usedOf, { n: c.uses, max: c.max_uses }) : String(c.uses);
            const usedUp = c.max_uses != null && c.uses >= c.max_uses;
            const valid = c.expires_at ? date(c.expires_at) : p.noLimit;
            const active = (
              <Switch
                checked={c.active}
                onChange={(v) => togglePromo(c, v)}
                label={`${p.promoCols.active}: ${c.code}`}
                disabled={readOnly}
              />
            );
            const edit = !readOnly && (
              <button
                type="button"
                onClick={() => setEditing(c)}
                aria-label={`${p.edit} ${c.code}`}
                className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
              >
                <Icon name="edit" size={20} />
              </button>
            );
            return (
              <li key={c.id} className="border-t border-outline-variant px-5 py-3">
                <div className="hidden grid-cols-[180px_130px_150px_150px_170px_72px_minmax(0,1fr)] items-center gap-4 lg:grid">
                  <span className="truncate text-title-s text-on-surface">{c.code}</span>
                  <span className="text-body-l text-on-surface tabular-nums">{off}</span>
                  <span className="text-body-m text-on-surface-variant">{packName(c.pack_id)}</span>
                  <span className="flex items-center gap-2 text-body-m text-on-surface tabular-nums">
                    {used}
                    {usedUp && <Chip tone="error">{p.usedUp}</Chip>}
                  </span>
                  <span className="text-body-m text-on-surface-variant">{valid}</span>
                  {active}
                  <span className="justify-self-end">{edit}</span>
                </div>
                <div className="flex items-center gap-3 lg:hidden">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-title-s text-on-surface">{c.code}</span>
                    <span className="text-body-s text-on-surface-variant">
                      {off} · {packName(c.pack_id)} · {used}
                      {usedUp && ` · ${p.usedUp}`}
                    </span>
                  </span>
                  {edit}
                  {active}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Preview */}
      <section className="flex flex-col gap-1">
        <h2 className="text-title-m text-on-surface">{p.previewTitle}</h2>
        <p className="text-body-s text-on-surface-variant">{p.previewHint}</p>
        <div aria-hidden inert>
          <PackCards
            packs={previewPacks}
            discountUntil={until}
            t={t}
            locale={locale}
            className="grid grid-cols-1 sm:grid-cols-2"
          />
        </div>
      </section>

      {/* Save bar: above the navigation bar on phones, at the bottom of the window from medium up. */}
      {!readOnly && dirty && (
        <>
          <div aria-hidden className="h-16" />
          <div className="fixed inset-x-0 bottom-20 z-10 flex items-center gap-2 bg-surface-container px-4 py-3 md:sticky md:bottom-4 md:rounded-lg md:pl-5">
            <span className="min-w-0 flex-1 text-body-m text-on-surface">{p.unsaved}</span>
            <button type="button" onClick={reset} disabled={busy} className="btn-secondary">
              {p.cancel}
            </button>
            <button type="button" onClick={save} disabled={busy} className="btn-primary">
              <Icon name="check" size={18} />
              {busy ? p.saving : p.save}
            </button>
          </div>
        </>
      )}

      {editing && (
        <PromoDialog
          promo={editing === "new" ? null : editing}
          packs={data.packs}
          t={t}
          locale={locale}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Create or change a promo code. */
function PromoDialog({
  promo,
  packs,
  t,
  locale,
  onClose,
  onSaved,
}: {
  promo: DbPromo | null;
  packs: DbPack[];
  t: Dictionary;
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const p = t.admin.pricing;
  const d = p.dialog;
  const [code, setCode] = useState(promo?.code ?? "");
  const [kind, setKind] = useState<"percent" | "amount">(promo?.kind ?? "percent");
  const [value, setValue] = useState(promo ? String(promo.value) : "");
  const [packId, setPackId] = useState(promo?.pack_id ?? "");
  const [maxUses, setMaxUses] = useState(promo?.max_uses ? String(promo.max_uses) : "");
  const [perUser, setPerUser] = useState(String(promo?.per_user_limit ?? 1));
  const [until, setUntil] = useState(toLocalInput(promo?.expires_at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const BG = "bg-surface-container-high";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(clean) || !num(value) || (kind === "percent" && num(value) > 90)) {
      setError(p.errors.bad_promo);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await savePromo({
      id: promo?.id ?? null,
      code: clean,
      kind,
      value: num(value),
      pack_id: packId || null,
      max_uses: maxUses ? num(maxUses) : null,
      per_user_limit: Math.max(num(perUser), 1),
      expires_at: fromLocalInput(until),
      active: promo?.active ?? true,
    });
    setBusy(false);
    if ("ok" in result) onSaved();
    else setError(p.errors[result.error] ?? p.errors.failed);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/32 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-dialog-title"
        className="flex max-h-full w-full max-w-[480px] flex-col gap-5 overflow-y-auto rounded-xl bg-surface-container-high p-6"
      >
        <h2 id="promo-dialog-title" className="text-headline-s text-on-surface">
          {promo ? d.editTitle : d.newTitle}
        </h2>
        <label className="relative flex h-14 items-center rounded-xs border border-outline px-4 focus-within:border-2 focus-within:border-primary focus-within:px-[15px]">
          <span className={`pointer-events-none absolute -top-2 left-3 px-1 text-body-s text-on-surface-variant ${BG}`}>
            {d.code}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24))}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface outline-none"
          />
        </label>
        <div className="max-w-[280px]">
          <Segmented<"percent" | "amount">
            label={d.kind}
            value={kind}
            onChange={setKind}
            alwaysCheck
            options={[
              { value: "percent", label: d.percent },
              { value: "amount", label: d.amount },
            ]}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <Field
            label={d.value}
            prefix={kind === "amount" ? "Rp" : undefined}
            suffix={kind === "percent" ? "%" : undefined}
            value={value}
            onChange={(v) => setValue(kind === "percent" ? v.slice(0, 2) : v)}
            bg={BG}
          />
          <label className="relative flex h-14 items-center rounded-xs border border-outline focus-within:border-2 focus-within:border-primary">
            <span className={`pointer-events-none absolute -top-2 left-3 px-1 text-body-s text-on-surface-variant ${BG}`}>
              {d.appliesTo}
            </span>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="h-full w-full appearance-none bg-transparent px-4 text-body-l text-on-surface outline-none"
            >
              <option value="">{p.anyPack}</option>
              {packs.map((x) => (
                <option key={x.id} value={x.id}>
                  {count(x.credits, locale)} {p.creditsUnit} · {rupiah(salePrice(x, null))}
                </option>
              ))}
            </select>
            <Icon name="arrowDropDown" className="pointer-events-none absolute right-3 text-on-surface-variant" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.maxUses} suffix={d.times} value={maxUses} onChange={setMaxUses} bg={BG} />
          <Field label={d.perUser} suffix={d.times} value={perUser} onChange={setPerUser} bg={BG} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Field type="datetime-local" label={d.until} value={until} onChange={setUntil} bg={BG} />
          <p className="text-body-s text-on-surface-variant">{d.limitsHint}</p>
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-body-m text-error">
            <Icon name="error" size={18} className="shrink-0" />
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
          >
            {p.cancel}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary px-6">
            {promo ? d.save : d.create}
          </button>
        </div>
      </div>
    </div>
  );
}
