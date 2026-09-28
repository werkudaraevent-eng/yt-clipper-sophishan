"use client";

import { useState } from "react";

const QUICK = [60, 150, 300, -60];

/** Amount input with quick-pick chips; the chips only fill the field. */
export function AmountField({ label, quickLabel }: { label: string; quickLabel: string }) {
  const [amount, setAmount] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input
          id="amount"
          name="amount"
          type="number"
          step={1}
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input h-14"
        />
        <label
          htmlFor="amount"
          className="pointer-events-none absolute -top-2 left-3 bg-surface-container-low px-1 text-body-s text-on-surface-variant"
        >
          {label}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-body-m text-on-surface-variant">{quickLabel}</span>
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
    </div>
  );
}
