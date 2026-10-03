import { wibDaysBetween } from "@clipper/shared/schedule";
import { TIME_ZONE } from "./format";

/** Times and dates for the scheduler, always in WIB. Safe for client components. */

function tag(locale: string) {
  return locale === "id" ? "id-ID" : "en-GB";
}

/** "19.00" (id) or "19:00" (en). */
export function wibClock(at: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  }).format(new Date(at));
}

/** "Kamis, 1 Okt" or, short, "Kam, 1 Okt". */
export function wibDay(at: Date | string, locale: string, weekday: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday,
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(at));
}

/** "Hari ini" / "Besok" for today and tomorrow, otherwise null. */
export function relativeDay(
  at: Date | string,
  now: Date,
  labels: { today: string; tomorrow: string },
): string | null {
  const days = wibDaysBetween(now, new Date(at));
  if (days === 0) return labels.today;
  if (days === 1) return labels.tomorrow;
  return null;
}

/** "Hari ini · 19.00", or "Sabtu, 3 Okt · 12.00" further out. */
export function slotTitle(
  at: Date | string,
  now: Date,
  locale: string,
  labels: { today: string; tomorrow: string },
): string {
  return `${relativeDay(at, now, labels) ?? wibDay(at, locale)} · ${wibClock(at, locale)}`;
}

/** "YYYY-MM-DD" and "HH:MM" in WIB, the values of date and time inputs. */
export function wibInputs(at: Date | string): { date: string; time: string } {
  const d = new Date(new Date(at).getTime() + 7 * 3600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

/** The instant for WIB date and time input values, or null when incomplete. */
export function fromWibInputs(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = new Date(`${date}T${time}:00+07:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}
