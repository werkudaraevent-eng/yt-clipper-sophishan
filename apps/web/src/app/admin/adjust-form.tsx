"use client";

import { useState } from "react";
import { adjustCredits } from "./actions";

const QUICK = [60, 150, 300, -60];

/** Amount, reason and save on one row, with quick amounts below that only fill the field. */
export function AdjustForm({
  email,
  userId,
  labels,
}: {
  email: string;
  userId: string;
  labels: { amount: string; note: string; notePlaceholder: string; apply: string; quick: string };
}) {
  const [amount, setAmount] = useState("");
  const outlinedLabel =
    "pointer-events-none absolute -top-2 left-3 bg-surface-container-low px-1 text-body-s text-on-surface-variant";
  return (
    <form action={adjustCredits} className="flex flex-col gap-4">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative sm:w-40">
          <input
            id="amount"
            name="amount"
            type="number"
            step={1}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input h-14 tabular-nums"
          />
          <label htmlFor="amount" className={outlinedLabel}>
            {labels.amount}
          </label>
        </div>
        <div className="relative flex-1">
          <input id="note" name="note" maxLength={200} placeholder={labels.notePlaceholder} className="input h-14" />
          <label htmlFor="note" className={outlinedLabel}>
            {labels.note}
          </label>
        </div>
        <button className="btn-primary h-14 px-8">{labels.apply}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-body-m text-on-surface-variant">{labels.quick}</span>
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            aria-pressed={amount === String(q)}
            onClick={() => setAmount(String(q))}
            className="chip tabular-nums"
          >
            {q > 0 ? `+${q}` : `−${-q}`}
          </button>
        ))}
      </div>
    </form>
  );
}
