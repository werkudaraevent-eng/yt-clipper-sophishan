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
  alwaysCheck = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  /** Show the selected check on compact windows too (fine with two or three segments). */
  alwaysCheck?: boolean;
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
            {selected && <Icon name="check" size={18} className={alwaysCheck ? undefined : "hidden sm:block"} />}
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

/** M3 outlined text field used as a select, with the label resting on the outline. */
export function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
  supporting,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  supporting?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="input h-14 appearance-none pr-10"
        >
          {children}
        </select>
        <label
          htmlFor={id}
          className="pointer-events-none absolute -top-2 left-3 bg-surface-container-lowest px-1 text-body-s text-on-surface-variant"
        >
          {label}
        </label>
        <Icon
          name="arrowDropDown"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant"
        />
      </div>
      {supporting && <p className="mt-1 px-4 text-body-s text-on-surface-variant">{supporting}</p>}
    </div>
  );
}

/** Single-select row of M3 filter chips. */
export function ChoiceChips<T extends string>({
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
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-body-m text-on-surface">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="chip"
        >
          {o.value === value && <Icon name="check" size={18} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
