"use client";

import { useState, useTransition } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { savePostRhythm } from "@/lib/schedule-actions";
import { Segmented, Toggle } from "./controls";

/** J4 "Auto pace": how "Schedule several" spreads clips. Saved as soon as it changes. */
export function RhythmCard({
  perDay: initialPerDay,
  peakOnly: initialPeakOnly,
  labels,
}: {
  perDay: 1 | 2;
  peakOnly: boolean;
  labels: Dictionary["schedule"];
}) {
  const [perDay, setPerDay] = useState(initialPerDay);
  const [peakOnly, setPeakOnly] = useState(initialPeakOnly);
  const [, startTransition] = useTransition();

  function save(nextPerDay: 1 | 2, nextPeakOnly: boolean) {
    setPerDay(nextPerDay);
    setPeakOnly(nextPeakOnly);
    startTransition(() => savePostRhythm(nextPerDay, nextPeakOnly));
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-surface-container-low px-6 py-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-title-m text-on-surface">{labels.rhythmTitle}</h3>
        <p className="text-body-s text-on-surface-variant">{labels.rhythmIntro}</p>
      </div>
      <Segmented
        label={labels.rhythmTitle}
        value={String(perDay) as "1" | "2"}
        onChange={(v) => save(v === "2" ? 2 : 1, peakOnly)}
        alwaysCheck
        options={[
          { value: "1", label: labels.perDay[1] },
          { value: "2", label: labels.perDay[2] },
        ]}
      />
      <Toggle
        checked={peakOnly}
        onChange={(v) => save(perDay, v)}
        label={labels.peakOnly}
        hint={labels.peakOnlyHint}
        labelClassName="text-body-m"
      />
    </section>
  );
}
