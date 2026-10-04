import { fill, type Dictionary } from "./i18n/dictionaries";

export type Pack = {
  id: string;
  credits: number;
  price_idr: number;
  featured: boolean;
  /** 0 for no discount; only counts while pricing_settings.discount_until is ahead. */
  discount_percent: number;
};

/** "Rp149.000": Rupiah with dot grouping, no space and no decimals. */
export function rupiah(amount: number): string {
  return "Rp" + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount);
}

/** "1.000" in Indonesian, "1,000" in English. */
export function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US").format(n);
}

/** How much video a number of credits processes: "± 30 menit video", "± 5 jam video". */
export function videoTime(credits: number, t: Dictionary): string {
  if (credits < 60) return fill(t.buy.minutes, { m: credits });
  const h = Math.floor(credits / 60);
  const m = credits % 60;
  return m === 0 || h >= 5 ? fill(t.buy.hours, { h }) : fill(t.buy.hoursMinutes, { h, m });
}

/** Whether pack discounts still run; `until` null means they run until removed. */
export function discountsRunning(until: string | null, now = Date.now()): boolean {
  return !until || now < new Date(until).getTime();
}

/** What a pack costs now. Same sum as pack_price_now() in the database. */
export function salePrice(pack: Pick<Pack, "price_idr" | "discount_percent">, until: string | null): number {
  return pack.discount_percent > 0 && discountsRunning(until)
    ? Math.floor((pack.price_idr * (100 - pack.discount_percent) + 50) / 100)
    : pack.price_idr;
}

/** Price per credit at the sale price, and the saving against the smallest pack's normal rate. */
export function packMath(pack: Pack, packs: Pack[], until: string | null = null) {
  const base = packs.reduce((a, b) => (b.credits < a.credits ? b : a), pack);
  const price = salePrice(pack, until);
  const perCredit = price / pack.credits;
  const saving = Math.round((1 - perCredit / (base.price_idr / base.credits)) * 100);
  const discount = price < pack.price_idr ? pack.discount_percent : null;
  return { price, perCredit: Math.round(perCredit), saving: saving > 0 ? saving : null, discount };
}
