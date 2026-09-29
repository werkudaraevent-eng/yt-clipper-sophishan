import { fill, type Dictionary } from "./i18n/dictionaries";

export type Pack = { id: string; credits: number; price_idr: number; featured: boolean };

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

/** Price per credit and the saving against the smallest pack's rate. */
export function packMath(pack: Pack, packs: Pack[]) {
  const base = packs.reduce((a, b) => (b.credits < a.credits ? b : a), pack);
  const perCredit = pack.price_idr / pack.credits;
  const saving = Math.round((1 - perCredit / (base.price_idr / base.credits)) * 100);
  return { perCredit: Math.round(perCredit), saving: saving > 0 ? saving : null };
}
