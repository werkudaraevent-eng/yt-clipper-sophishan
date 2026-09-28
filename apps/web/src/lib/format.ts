export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
}

/** "Today", "Yesterday", or a short date like "24 Sep" (with the year when it differs). */
export function shortDate(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  const tag = locale === "id" ? "id-ID" : "en-US";
  if (days === 0 || days === 1) {
    const text = new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(-days, "day");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  }).format(date);
}
