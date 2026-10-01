import { describe, expect, it } from "vitest";
import { type BusyMap, busyMap, fromWib, LEARN_AFTER, planSlots, suggestSlots, toWib, wibDaysBetween } from "../schedule";

// Thursday 1 October 2026, 10:00 WIB.
const now = fromWib(2026, 10, 1, 10);
const wib = (d: Date) => {
  const t = toWib(d);
  return `${t.month}/${t.day} ${t.hour}`;
};

describe("WIB helpers", () => {
  it("converts both ways and counts calendar days", () => {
    expect(now.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(toWib(now)).toMatchObject({ day: 1, weekday: 3, hour: 10 });
    expect(wibDaysBetween(now, fromWib(2026, 10, 2, 0, 30))).toBe(1);
    expect(wibDaysBetween(fromWib(2026, 10, 1, 23), fromWib(2026, 10, 2, 1))).toBe(1);
  });
});

describe("busyMap", () => {
  it("uses the generic busy hours until enough Shorts have views", () => {
    const map = busyMap([{ at: fromWib(2026, 9, 28, 7), views: 5000 }]);
    expect(map.learned).toBe(false);
    expect(map.samples).toBe(1);
    // 19.00 is the busiest generic slot, 12.00 the second on weekdays.
    expect(map.cells[0][4]).toBe(1);
    expect(map.cells[0][2]).toBeGreaterThan(map.cells[0][5]);
  });

  it("learns the channel's own busy hours", () => {
    const stats = Array.from({ length: LEARN_AFTER + 2 }, (_, i) => ({
      // Mornings do great on this channel, evenings poorly.
      at: fromWib(2026, 9, 14 + i, i % 2 ? 7 : 19),
      views: i % 2 ? 900 : 30,
    }));
    const map = busyMap(stats);
    expect(map.learned).toBe(true);
    expect(map.cells[0][0]).toBeGreaterThan(map.cells[0][4]);
    const [weekday, block] = map.best[0];
    expect(block).toBe(0);
    expect(map.cells[weekday][block]).toBe(1);
  });

  it("doesn't let one viral Short take over", () => {
    const stats = Array.from({ length: LEARN_AFTER }, (_, i) => ({
      at: fromWib(2026, 9, 14 + i, 19),
      views: 100,
    }));
    stats.push({ at: fromWib(2026, 9, 21, 7), views: 1_000_000 });
    const map = busyMap(stats);
    expect(map.cells[0][0]).toBeLessThan(1);
  });
});

describe("suggestSlots", () => {
  it("offers today's evening first, then other days and hours", () => {
    const slots = suggestSlots(busyMap([]), { now });
    expect(slots.map((s) => wib(s.at))).toEqual(["10/1 19", "10/2 19", "10/3 12"]);
    expect(slots.map((s) => s.reason)).toEqual(["bestGeneric", null, "weekend"]);
    expect(slots.map((s) => s.best)).toEqual([true, false, false]);
    expect(slots.map((s) => s.days)).toEqual([0, 1, 2]);
  });

  it("moves away from times already taken and from the past", () => {
    const evening = fromWib(2026, 10, 1, 18, 50);
    const slots = suggestSlots(busyMap([]), { now: evening, taken: [fromWib(2026, 10, 2, 19)] });
    for (const s of slots) {
      expect(s.at.getTime()).toBeGreaterThan(evening.getTime());
      expect(wib(s.at)).not.toBe("10/2 19");
    }
  });

  it("stops before the clip expires", () => {
    const slots = suggestSlots(busyMap([]), { now, until: fromWib(2026, 10, 1, 20) });
    expect(slots.map((s) => wib(s.at))).toEqual(["10/1 12", "10/1 16", "10/1 19"]);
  });
});

describe("planSlots", () => {
  const map = busyMap([]);

  it("posts once a day at the busiest hour", () => {
    const plan = planSlots(map, 3, { now, start: now, perDay: 1, peakOnly: true });
    expect(plan.map(wib)).toEqual(["10/1 19", "10/2 19", "10/3 19"]);
  });

  it("posts twice a day at least four hours apart", () => {
    const plan = planSlots(map, 4, { now, start: now, perDay: 2, peakOnly: true });
    expect(plan.map(wib)).toEqual(["10/1 12", "10/1 19", "10/2 12", "10/2 19"]);
  });

  it("skips quiet hours when asked, even if the queue gets longer", () => {
    // Only the evening is busy on this channel.
    const evening: BusyMap = {
      cells: Array.from({ length: 7 }, () => [0.2, 0.2, 0.3, 0.2, 1, 0.4]),
      learned: true,
      samples: 12,
      best: [],
    };
    const options = { now, start: now, perDay: 2 as const };
    expect(planSlots(evening, 3, { ...options, peakOnly: true }).map(wib)).toEqual([
      "10/1 19",
      "10/2 19",
      "10/3 19",
    ]);
    expect(planSlots(evening, 3, { ...options, peakOnly: false }).map(wib)).toEqual([
      "10/1 12",
      "10/1 19",
      "10/2 19",
    ]);
  });

  it("avoids queued posts and returns fewer times when the window ends", () => {
    const plan = planSlots(map, 5, {
      now,
      start: now,
      perDay: 1,
      peakOnly: true,
      taken: [fromWib(2026, 10, 1, 19)],
      until: fromWib(2026, 10, 3, 23),
    });
    expect(plan.map(wib)).toEqual(["10/1 12", "10/2 19", "10/3 19"]);
  });
});
