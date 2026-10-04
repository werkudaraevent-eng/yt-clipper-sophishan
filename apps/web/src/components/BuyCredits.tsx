"use client";

import { useEffect, useRef, useState } from "react";
import { buyCredits, quotePromo, type Quote } from "@/app/credits/actions";
import { count, packMath, rupiah, salePrice, videoTime, type Pack } from "@/lib/credit-packs";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { Segmented } from "./controls";
import { Icon } from "./ui/Icon";

type Currency = "idr" | "usd";

/** Medium (56dp) common buttons from the design: filled and tonal. */
const FILLED_M =
  "state-layer focus-ring inline-flex h-14 items-center justify-center gap-2 rounded-full bg-primary px-6 text-title-m text-on-primary disabled:cursor-not-allowed disabled:bg-on-surface/12 disabled:text-on-surface/38";
const TONAL_M =
  "state-layer focus-ring inline-flex h-14 items-center justify-center gap-2 rounded-full bg-secondary-container px-6 text-title-m text-on-secondary-container";

/**
 * Pack picker for /credits. Wide windows get a row of pack cards, each with
 * its own Buy button; phones get a single-choice list with one Buy button in
 * a bar above the navigation bar. Both confirm in a dialog, then go to DOKU.
 */
export function BuyCredits({
  packs,
  discountUntil,
  t,
  locale,
}: {
  packs: Pack[];
  /** When pack discounts end; null while they run until removed. */
  discountUntil: string | null;
  t: Dictionary;
  locale: string;
}) {
  const [currency, setCurrency] = useState<Currency>("idr");
  const [selected, setSelected] = useState(() => (packs.find((p) => p.featured) ?? packs[0])?.id);
  const [confirming, setConfirming] = useState<Pack | null>(null);
  const chosen = packs.find((p) => p.id === selected) ?? packs[0];

  const segmented = (
    <Segmented<Currency>
      label={t.buy.currency}
      alwaysCheck
      value={currency}
      onChange={setCurrency}
      options={[
        { value: "idr", label: t.buy.rupiah },
        { value: "usd", label: t.buy.usd },
      ]}
    />
  );

  return (
    <>
      <section className="flex flex-col gap-4 md:gap-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <h2 className="text-title-m text-on-surface md:text-title-l">{t.buy.title}</h2>
            <p className="text-body-s text-on-surface-variant md:hidden">{t.buy.subtitleShort}</p>
            <p className="hidden text-body-m text-on-surface-variant md:block">{t.buy.subtitle}</p>
          </div>
          <div className="md:w-[220px] md:shrink-0">{segmented}</div>
        </div>

        {currency === "usd" ? (
          <p className="flex items-start gap-2 rounded-lg bg-surface-container-low p-5 text-body-m text-on-surface-variant">
            <Icon name="info" size={20} className="mt-0.5 shrink-0" />
            {t.buy.usdSoon}
          </p>
        ) : (
          <>
            {/* Cards: medium and wider windows. */}
            <PackCards packs={packs} discountUntil={discountUntil} t={t} locale={locale} onBuy={setConfirming} />

            {/* Single-choice list: compact windows. */}
            <div role="radiogroup" aria-label={t.buy.title} className="flex flex-col gap-2 md:hidden">
              {packs.map((p) => {
                const { price, perCredit, saving, discount } = packMath(p, packs, discountUntil);
                const on = p.id === chosen?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelected(p.id)}
                    className={`state-layer focus-ring flex items-center gap-3 rounded-lg py-3.5 pr-4 pl-3.5 text-left ${
                      on
                        ? "border-2 border-primary bg-secondary-container text-on-secondary-container"
                        : "border border-outline-variant bg-surface-container-lowest text-on-surface"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        on ? "border-primary" : "border-on-surface-variant"
                      }`}
                    >
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-title-m">
                          {count(p.credits, locale)} {t.buy.credits}
                        </span>
                        {p.featured && (
                          <span className="flex items-center gap-1 rounded-[6px] bg-tertiary-container py-0.5 pr-2 pl-1.5 text-label-m text-on-tertiary-container">
                            <Icon name="fire" size={14} />
                            {t.buy.popular}
                          </span>
                        )}
                      </span>
                      <span className={`text-body-s ${on ? "" : "text-on-surface-variant"}`}>
                        {videoTime(p.credits, t)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {discount && (
                        <s className={`text-body-s tabular-nums ${on ? "" : "text-on-surface-variant"}`}>
                          {rupiah(p.price_idr)}
                        </s>
                      )}
                      <span className="text-title-m tabular-nums">{rupiah(price)}</span>
                      {discount ? (
                        <span className="rounded-[6px] bg-success-container px-2 py-0.5 text-label-m text-on-success-container">
                          {fill(t.buy.discount, { n: discount })}
                        </span>
                      ) : saving ? (
                        <span className="rounded-[6px] bg-success-container px-2 py-0.5 text-label-m text-on-success-container">
                          {fill(t.buy.save, { n: saving })}
                        </span>
                      ) : (
                        <span className="text-body-s text-on-surface-variant">
                          {fill(t.buy.perCreditShort, {
                            price: rupiah(perCredit),
                          })}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="flex items-start gap-2 text-body-s text-on-surface-variant md:hidden">
              <Icon name="info" size={16} className="mt-0.5 shrink-0" />
              {t.buy.methodsNoteShort}
            </p>

            {/* Keeps the history clear of the fixed action bar. */}
            <div aria-hidden className="h-20 md:hidden" />
            {chosen && (
              <div className="fixed inset-x-0 bottom-20 z-10 flex items-center gap-3 bg-surface-container px-4 py-3 md:hidden">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-s text-on-surface-variant">{t.buy.total}</span>
                  <span className="text-title-l text-on-surface tabular-nums">
                    {rupiah(salePrice(chosen, discountUntil))}
                  </span>
                </span>
                <button type="button" onClick={() => setConfirming(chosen)} className={FILLED_M}>
                  {fill(t.buy.buyPack, { n: count(chosen.credits, locale) })}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {confirming && (
        <ConfirmDialog
          pack={confirming}
          sale={salePrice(confirming, discountUntil)}
          t={t}
          locale={locale}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/** The row of pack cards on /credits; also the preview on /admin (no onBuy). */
export function PackCards({
  packs,
  discountUntil,
  t,
  locale,
  onBuy,
  className = "hidden md:grid",
}: {
  packs: Pack[];
  discountUntil: string | null;
  t: Dictionary;
  locale: string;
  onBuy?: (pack: Pack) => void;
  className?: string;
}) {
  const untilLabel = discountUntil
    ? fill(t.buy.until, {
        date: new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
          day: "numeric",
          month: "short",
        }).format(new Date(discountUntil)),
      })
    : null;
  return (
    <ul className={`gap-4 pt-3 md:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {packs.map((p) => {
        const { price, perCredit, saving, discount } = packMath(p, packs, discountUntil);
        return (
          <li
            key={p.id}
            className={`relative flex flex-col gap-4 rounded-lg bg-surface-container-lowest p-5 ${
              p.featured ? "border-2 border-primary shadow-elev-2" : "border border-outline-variant"
            }`}
          >
            {p.featured && (
              <span className="absolute -top-[13px] left-5 flex items-center gap-1 rounded-sm bg-tertiary-container py-1 pr-2.5 pl-2 text-label-m text-on-tertiary-container">
                <Icon name="fire" size={16} />
                {t.buy.popular}
              </span>
            )}
            <div className="flex flex-col gap-0.5">
              <p className="flex items-baseline gap-1.5">
                <span className="text-headline-m text-on-surface tabular-nums">{count(p.credits, locale)}</span>
                <span className="text-title-m text-on-surface-variant">{t.buy.credits}</span>
              </p>
              <p className="text-body-s text-on-surface-variant">{videoTime(p.credits, t)}</p>
            </div>
            <hr className="border-outline-variant" />
            <div className="flex flex-col gap-0.5">
              {discount && (
                <p className="text-body-s text-on-surface-variant">
                  <s className="tabular-nums">{rupiah(p.price_idr)}</s>
                  {untilLabel && ` · ${untilLabel}`}
                </p>
              )}
              <p className={`text-title-l tabular-nums ${discount ? "text-primary" : "text-on-surface"}`}>
                {rupiah(price)}
              </p>
              <div className="flex h-12 flex-col items-start gap-2">
                <span className="text-body-s text-on-surface-variant">
                  {fill(t.buy.perCredit, { price: rupiah(perCredit) })}
                </span>
                {discount ? (
                  <span className="rounded-sm bg-success-container px-2.5 py-1 text-label-m text-on-success-container">
                    {fill(t.buy.discount, { n: discount })}
                  </span>
                ) : (
                  saving && (
                    <span className="rounded-sm bg-success-container px-2.5 py-1 text-label-m text-on-success-container">
                      {fill(t.buy.save, { n: saving })}
                    </span>
                  )
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onBuy?.(p)}
              tabIndex={onBuy ? undefined : -1}
              className={`${p.featured ? FILLED_M : TONAL_M} mt-auto w-full`}
            >
              {t.buy.buy}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** M3 basic dialog with a hero icon: the last look before leaving for DOKU. */
function ConfirmDialog({
  pack,
  sale,
  t,
  locale,
  onClose,
}: {
  pack: Pack;
  /** The pack's price now, after its own discount. */
  sale: number;
  t: Dictionary;
  locale: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const total = quote?.promo_applied ? quote.amount : sale;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  const date = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
  }).format(validUntil);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function applyCode() {
    if (!code.trim() || checking) return;
    setChecking(true);
    setPromoError(null);
    const result = await quotePromo(pack.id, code);
    setChecking(false);
    if ("quote" in result) setQuote(result.quote);
    else {
      setQuote(null);
      setPromoError(t.buy.promoErrors[result.error]);
    }
  }

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await buyCredits(pack.id, quote?.promo_applied ? quote.promo_code : null);
    if ("url" in result) {
      window.location.assign(result.url);
      return;
    }
    if ("promoError" in result) {
      setQuote(null);
      setPromoError(t.buy.promoErrors[result.promoError]);
    } else setError(t.buy.errors[result.error]);
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/32 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="buy-dialog-title"
        className="flex w-full max-w-[400px] flex-col items-center gap-4 rounded-xl bg-surface-container-high p-6 text-center"
      >
        <Icon name="tollFill" size={24} className="text-primary" />
        <h2 id="buy-dialog-title" className="text-headline-s text-on-surface">
          {fill(t.buy.confirmTitle, { n: count(pack.credits, locale) })}
        </h2>
        <p className="text-body-m text-on-surface-variant">{t.buy.confirmBody}</p>
        <div className="flex w-full flex-col gap-1.5 text-left">
          <div className="relative">
            <input
              id="promo-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setQuote(null);
                setPromoError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && applyCode()}
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              className="input h-14 pr-24 uppercase"
            />
            <label
              htmlFor="promo-code"
              className="pointer-events-none absolute -top-2 left-3 bg-surface-container-high px-1 text-body-s text-on-surface-variant"
            >
              {t.buy.promoLabel}
            </label>
            <button
              type="button"
              onClick={applyCode}
              disabled={!code.trim() || checking}
              className="state-layer focus-ring absolute top-2 right-2 inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
            >
              {t.buy.promoApply}
            </button>
          </div>
          {quote && (
            <p className="flex items-center gap-1.5 text-body-s text-primary">
              <Icon name="checkCircle" size={16} className="shrink-0" />
              {quote.promo_applied
                ? fill(t.buy.promoApplied, {
                    code: quote.promo_code ?? "",
                    amount: rupiah(pack.price_idr - quote.amount),
                  })
                : fill(t.buy.promoNotBetter, { code: quote.promo_code ?? "" })}
            </p>
          )}
          {promoError && (
            <p role="alert" className="flex items-center gap-1.5 text-body-s text-error">
              <Icon name="error" size={16} className="shrink-0" />
              {promoError}
            </p>
          )}
        </div>
        <dl className="w-full rounded-md bg-surface-container-low px-4 py-1 text-left">
          <div className="flex items-center gap-3 py-2.5">
            <dt className="flex-1 text-body-m text-on-surface-variant">{t.buy.pack}</dt>
            <dd className="text-title-s text-on-surface">
              {count(pack.credits, locale)} {t.buy.credits}
            </dd>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <dt className="flex-1 text-body-m text-on-surface-variant">{t.buy.validUntil}</dt>
            <dd className="text-title-s text-on-surface">{date}</dd>
          </div>
          {sale < pack.price_idr && !quote?.promo_applied && (
            <div className="flex items-center gap-3 py-2.5">
              <dt className="flex-1 text-body-m text-on-surface-variant">
                {fill(t.buy.discount, { n: pack.discount_percent })}
              </dt>
              <dd className="text-title-s text-primary tabular-nums">−{rupiah(pack.price_idr - sale)}</dd>
            </div>
          )}
          {quote?.promo_applied && (
            <div className="flex items-center gap-3 py-2.5">
              <dt className="flex-1 text-body-m text-on-surface-variant">
                {fill(t.buy.promoRow, { code: quote.promo_code ?? "" })}
              </dt>
              <dd className="text-title-s text-primary tabular-nums">−{rupiah(pack.price_idr - quote.amount)}</dd>
            </div>
          )}
          <div className="flex items-center gap-3 py-2.5">
            <dt className="flex-1 text-body-m text-on-surface-variant">{t.buy.total}</dt>
            <dd className="text-title-m text-on-surface tabular-nums">{rupiah(total)}</dd>
          </div>
        </dl>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-body-m text-error">
            <Icon name="error" size={18} className="shrink-0" />
            {error}
          </p>
        )}
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
          >
            {t.buy.cancel}
          </button>
          <button ref={confirmRef} type="button" onClick={go} disabled={busy} className="btn-primary px-6">
            {busy ? t.buy.opening : t.buy.continue}
          </button>
        </div>
      </div>
    </div>
  );
}
