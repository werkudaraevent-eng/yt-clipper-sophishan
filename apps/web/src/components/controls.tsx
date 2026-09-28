"use client";

import { useId } from "react";

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-accent" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "left-5.5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Two-thumb range slider built from two native range inputs. */
export function RangeSlider({
  min,
  max,
  start,
  end,
  step = 1,
  onChange,
  format,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  step?: number;
  onChange: (start: number, end: number) => void;
  format: (value: number) => string;
}) {
  const span = Math.max(max - min, 1);
  const left = ((start - min) / span) * 100;
  const right = ((end - min) / span) * 100;
  const thumb =
    "pointer-events-none absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 " +
    "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none " +
    "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 " +
    "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full " +
    "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent";
  return (
    <div>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-2 h-1 rounded bg-border" />
        <div
          className="absolute top-2 h-1 rounded bg-accent"
          style={{ left: `${left}%`, width: `${right - left}%` }}
        />
        <input
          type="range"
          aria-label="Start"
          min={min}
          max={max}
          step={step}
          value={start}
          onChange={(e) => onChange(Math.min(Number(e.target.value), end - step), end)}
          className={thumb}
        />
        <input
          type="range"
          aria-label="End"
          min={min}
          max={max}
          step={step}
          value={end}
          onChange={(e) => onChange(start, Math.max(Number(e.target.value), start + step))}
          className={thumb}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="rounded bg-accent-soft px-2 py-0.5 text-accent">{format(start)}</span>
        <span className="rounded bg-accent-soft px-2 py-0.5 text-accent">{format(end)}</span>
      </div>
    </div>
  );
}
