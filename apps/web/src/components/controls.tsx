"use client";

import { useId } from "react";
import { Icon } from "./ui/Icon";

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
      <label htmlFor={id} className="text-title-s text-on-surface">
        {label}
        {hint && <span className="block text-body-s text-on-surface-variant">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`focus-ring relative h-8 w-13 shrink-0 rounded-full border-2 transition-colors ${
          checked ? "border-primary bg-primary" : "border-outline bg-surface-container-highest"
        }`}
      >
        <span
          className={`absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full transition-all ${
            checked
              ? "left-[22px] h-6 w-6 bg-on-primary text-primary"
              : "left-[6px] h-4 w-4 bg-outline"
          }`}
        >
          {checked && <Icon name="check" size={16} />}
        </span>
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
    <div role="group" aria-label={label} className="flex w-full">
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`state-layer focus-ring flex h-10 min-w-12 flex-1 items-center justify-center gap-2 border border-outline px-2 text-label-l whitespace-nowrap sm:px-3 ${
              i === 0 ? "rounded-l-full" : "-ml-px"
            } ${i === options.length - 1 ? "rounded-r-full" : ""} ${
              selected ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
            }`}
          >
            {selected && <Icon name="check" size={18} className="hidden sm:block" />}
            {o.label}
          </button>
        );
      })}
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
    "pointer-events-none absolute inset-x-0 top-0 h-11 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-11 " +
    "[&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none " +
    "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-11 " +
    "[&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded-full " +
    "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";
  return (
    <div>
      <div className="relative h-11">
        <div className="absolute inset-x-0 top-3.5 h-4 rounded-full bg-secondary-container" />
        <div
          className="absolute top-3.5 h-4 rounded-xs bg-primary"
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
        <span className="rounded-sm bg-inverse-surface px-2 py-0.5 text-label-m text-inverse-on-surface">{format(start)}</span>
        <span className="rounded-sm bg-inverse-surface px-2 py-0.5 text-label-m text-inverse-on-surface">{format(end)}</span>
      </div>
    </div>
  );
}
