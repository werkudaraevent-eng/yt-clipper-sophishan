export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
}

/** "0:42", "12:04" or "1:02:03": a clip length or a moment in a video. */
export function shortClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** "12:02,0" (Indonesian) or "12:02.0": a moment to the tenth of a second. */
export function tenths(seconds: number, locale: string): string {
  const d = Math.max(0, Math.round(seconds * 10));
  return `${shortClock(Math.floor(d / 10))}${locale === "id" ? "," : "."}${d % 10}`;
}

/** Most users are in Indonesia and pages render on a UTC server, so times use WIB. */
export const TIME_ZONE = "Asia/Jakarta";

/** Calendar day in WIB as a UTC midnight timestamp, for day differences. */
function wibDay(d: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

/** "Today", "Yesterday", or a short date like "24 Sep" (with the year when it differs), in WIB. */
export function shortDate(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((wibDay(now) - wibDay(date)) / 86_400_000);
  const tag = locale === "id" ? "id-ID" : "en-US";
  if (days === 0 || days === 1) {
    const text = new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(-days, "day");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const year = (d: Date) => new Date(wibDay(d)).getUTCFullYear();
  return new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
    ...(year(date) !== year(now) && { year: "numeric" }),
  }).format(date);
}

/** "09:15" in WIB (id-ID would print "09.15"). */
export function hhmm(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
}

/** "29 Sep, 14:47" in WIB. */
export function dayAndTime(iso: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
  return `${day}, ${hhmm(iso)}`;
}
