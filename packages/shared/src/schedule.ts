/**
 * Picking times to post Shorts. Everything is in WIB (UTC+7, no daylight
 * saving), the time zone the app shows everywhere.
 *
 * The day is split into six blocks starting at 06, 09, 12, 15, 18 and 21, and
 * each block has one posting hour. Until a channel has LEARN_AFTER Shorts with
 * a 24-hour view count, blocks are ranked by generic busy hours in Indonesia;
 * after that the channel's own views pull the ranking toward its audience.
 */

const HOUR = 3_600_000;
const WIB_OFFSET = 7 * HOUR;

export const BLOCK_STARTS = [6, 9, 12, 15, 18, 21] as const;
export const POST_HOURS = [7, 10, 12, 16, 19, 21] as const;
export const LEARN_AFTER = 10;

/** Index of the 12.00 block, the lunch break. */
const LUNCH = 2;
/** Generic busy hours per block, weekdays and weekends (Saturday, Sunday). */
const WEEKDAY = [0.3, 0.35, 0.8, 0.5, 1, 0.7];
const WEEKEND = [0.35, 0.55, 0.9, 0.65, 1, 0.75];
/** How many Shorts the generic ranking is worth when blending in views. */
const PRIOR_WEIGHT = 4;
/** Posts closer than this to another one compete for the same audience. */
const GAP = 3 * HOUR;
/** Slots at least this busy (relative to the busiest) count as peak hours. */
export const PEAK = 0.6;

export type WibTime = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  hour: number;
  minute: number;
};

export function toWib(date: Date): WibTime {
  const d = new Date(date.getTime() + WIB_OFFSET);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: (d.getUTCDay() + 6) % 7,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** The instant a WIB wall-clock time happens. Day overflow rolls over, like Date.UTC. */
export function fromWib(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - WIB_OFFSET);
}

/** Midnight WIB of the day `date` falls on, `days` later. */
export function wibDayStart(date: Date, days = 0): Date {
  const w = toWib(date);
  return fromWib(w.year, w.month, w.day + days);
}

/** Whole WIB calendar days from `from` to `to` (0 = same day, 1 = the next). */
export function wibDaysBetween(from: Date, to: Date): number {
  return Math.round((wibDayStart(to).getTime() - wibDayStart(from).getTime()) / (24 * HOUR));
}

/** The block a WIB hour belongs to; small hours count as the night before or the morning. */
export function blockOf(hour: number): number {
  if (hour < 6) return hour < 3 ? 5 : 0;
  return Math.min(5, Math.floor((hour - 6) / 3));
}

function prior(weekday: number, block: number) {
  return (weekday >= 5 ? WEEKEND : WEEKDAY)[block];
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const BLOCKS = [0, 1, 2, 3, 4, 5];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type ViewStat = { at: string | Date; views: number };

export type BusyMap = {
  /** [weekday][block], 0–1 relative to the busiest slot. */
  cells: number[][];
  /** True once the channel's own views drive the ranking. */
  learned: boolean;
  /** Shorts with a 24-hour view count. */
  samples: number;
  /** The three busiest slots as [weekday, block]. */
  best: [number, number][];
};

/**
 * How busy each weekday and block is for this channel. Before LEARN_AFTER
 * samples this is the generic ranking. After, each Short scores by its rank
 * among the channel's Shorts (0 worst, 1 best, so one viral Short counts no
 * more than any other top Short), averaged per block and then per slot, each
 * time shrunk toward the generic ranking so a few posts don't decide a slot.
 */
export function busyMap(stats: ViewStat[]): BusyMap {
  const samples = stats.filter((s) => Number.isFinite(s.views) && s.views >= 0);
  const learned = samples.length >= LEARN_AFTER;
  let raw = DAYS.map((d) => BLOCKS.map((b) => prior(d, b)));

  if (learned) {
    const meanPrior = sum(raw.flat()) / raw.flat().length;
    // The generic ranking on the same 0–1 scale as the ranks, centred on 0.5.
    const scaled = (d: number, b: number) => 0.5 + 0.25 * (prior(d, b) / meanPrior - 1);
    const views = samples.map((s) => s.views);
    const points = samples.map((s) => {
      const t = toWib(new Date(s.at));
      const below = views.filter((v) => v < s.views).length;
      const equal = views.filter((v) => v === s.views).length;
      return { day: t.weekday, block: blockOf(t.hour), x: (below + equal / 2) / views.length };
    });
    const blockPrior = BLOCKS.map((b) => sum(DAYS.map((d) => scaled(d, b))) / DAYS.length);
    const blockEstimate = BLOCKS.map((b) => {
      const xs = points.filter((p) => p.block === b).map((p) => p.x);
      return (PRIOR_WEIGHT * blockPrior[b] + sum(xs)) / (PRIOR_WEIGHT + xs.length);
    });
    raw = DAYS.map((d) =>
      BLOCKS.map((b) => {
        const base = blockEstimate[b] + scaled(d, b) - blockPrior[b];
        const xs = points.filter((p) => p.block === b && p.day === d).map((p) => p.x);
        return (PRIOR_WEIGHT * base + sum(xs)) / (PRIOR_WEIGHT + xs.length);
      }),
    );
  }

  const max = Math.max(...raw.flat());
  const cells = raw.map((row) => row.map((v) => (max > 0 ? v / max : 0)));
  const best = DAYS.flatMap((d) => BLOCKS.map((b) => [d, b] as [number, number]))
    .sort((a, b) => cells[b[0]][b[1]] - cells[a[0]][a[1]])
    .slice(0, 3);
  return { cells, learned, samples: samples.length, best };
}

export type SlotReason = "best" | "bestGeneric" | "lunch" | "weekend" | "free";

export type Slot = {
  at: Date;
  /** WIB calendar days from now. */
  days: number;
  best: boolean;
  reason: SlotReason | null;
};

type Window = {
  now: Date;
  /** Times other posts already go up. */
  taken?: (string | Date)[];
  /** Nothing after this (the clip is deleted soon after). */
  until?: Date | null;
};

function times(values: (string | Date)[] | undefined) {
  return (values ?? []).map((v) => new Date(v).getTime());
}

/** The earliest a new post can be scheduled, leaving time to change one's mind. */
export function earliestSlot(now: Date) {
  return new Date(now.getTime() + 15 * 60_000);
}

/**
 * Up to `count` good times in the next week, in time order. The busiest is
 * marked best. Times near another queued post are pushed down the list, and
 * the picks are at least three hours apart so they are real alternatives.
 * Sooner is a little better than later: the clip is fresh now.
 */
export function suggestSlots(map: BusyMap, { now, taken, until, count = 3 }: Window & { count?: number }): Slot[] {
  const earliest = earliestSlot(now).getTime();
  const others = times(taken);
  type Candidate = { at: Date; days: number; block: number; weekday: number; clash: boolean; score: number };
  const candidates: Candidate[] = [];
  for (let d = 0; d < 7; d++) {
    const day = toWib(wibDayStart(now, d));
    for (const b of BLOCKS) {
      const at = fromWib(day.year, day.month, day.day, POST_HOURS[b]);
      if (at.getTime() < earliest || (until && at > until)) continue;
      const clash = others.some((t) => Math.abs(t - at.getTime()) < GAP);
      const score = map.cells[day.weekday][b] * (1 - 0.05 * d) * (clash ? 0.2 : 1);
      candidates.push({ at, days: d, block: b, weekday: day.weekday, clash, score });
    }
  }
  // Greedy picks; each pick makes its hour a little less attractive, so the
  // choices offer different times of day rather than the same hour thrice.
  const picked: Candidate[] = [];
  const usedBlocks: number[] = [];
  while (picked.length < count) {
    const open = candidates.filter(
      (c) => !picked.some((p) => Math.abs(p.at.getTime() - c.at.getTime()) < GAP),
    );
    if (!open.length) break;
    const value = (c: Candidate) =>
      c.score * 0.75 ** usedBlocks.filter((b) => b === c.block).length;
    const next = open.reduce((a, b) => (value(b) > value(a) ? b : a));
    picked.push(next);
    usedBlocks.push(next.block);
  }
  const top = picked[0];
  return picked
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((c) => {
      let reason: SlotReason | null = null;
      if (c === top) reason = map.learned ? "best" : "bestGeneric";
      else if (c.weekday >= 5) reason = "weekend";
      else if (map.learned) reason = c.clash ? null : "free";
      else if (c.block === LUNCH) reason = "lunch";
      return { at: c.at, days: c.days, best: c === top, reason };
    });
}

/**
 * Times for `count` clips, one or two a day from the start day on, each day
 * at its busiest hours (only peak hours when `peakOnly`). Two posts on one
 * day are at least four hours apart, and none lands near an already queued
 * post. Returns fewer times when the window runs out.
 */
export function planSlots(
  map: BusyMap,
  count: number,
  {
    now,
    start,
    perDay,
    peakOnly,
    taken,
    until,
  }: Window & { start: Date; perDay: 1 | 2; peakOnly: boolean },
): Date[] {
  const earliest = earliestSlot(now).getTime();
  const others = times(taken);
  const plan: Date[] = [];
  for (let d = 0; d < 60 && plan.length < count; d++) {
    const day = toWib(wibDayStart(start, d));
    const first = fromWib(day.year, day.month, day.day, POST_HOURS[0]);
    if (until && first > until) break;
    const ranked = [...BLOCKS].sort((a, b) => map.cells[day.weekday][b] - map.cells[day.weekday][a] || b - a);
    const chosen: Date[] = [];
    for (const b of ranked) {
      if (chosen.length >= perDay || plan.length + chosen.length >= count) break;
      if (peakOnly && map.cells[day.weekday][b] < PEAK) continue;
      const at = fromWib(day.year, day.month, day.day, POST_HOURS[b]);
      if (at.getTime() < earliest || (until && at > until)) continue;
      if (others.some((t) => Math.abs(t - at.getTime()) < GAP)) continue;
      if (chosen.some((c) => Math.abs(c.getTime() - at.getTime()) < 4 * HOUR)) continue;
      chosen.push(at);
    }
    plan.push(...chosen.sort((a, b) => a.getTime() - b.getTime()));
  }
  return plan;
}
