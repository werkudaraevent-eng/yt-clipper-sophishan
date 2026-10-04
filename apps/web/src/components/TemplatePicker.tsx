"use client";

import type { CaptionTemplate } from "@clipper/shared";
import { useDictionary } from "@/lib/i18n/client";
import { Icon } from "./ui/Icon";

type Sample = [string, string, string];

const DEFAULT_SAMPLES: Record<CaptionTemplate, Sample> = {
  karaoke: ["and", "the", "problem"],
  box: ["big", "step", "changes"],
  ali: ["the", "same", "way"],
};

const PREVIEWS: Record<CaptionTemplate, { name: string; render: (s: Sample, size: string) => React.ReactNode }> = {
  karaoke: {
    name: "Karaoke",
    render: ([a, b, c], size) => (
      <span className={`text-center ${size} leading-tight font-black text-white uppercase [text-shadow:0_0_3px_#000,0_0_3px_#000]`}>
        {a} <span className="text-[#39FF14]">{b}</span>
        <br />
        {c}
      </span>
    ),
  },
  box: {
    name: "Box",
    render: ([a, b], size) => (
      <span className={`${size} font-black text-white uppercase [text-shadow:0_0_2px_#000]`}>
        {a} <span className="bg-[#E0245E] px-0.5">{b}</span>
      </span>
    ),
  },
  ali: {
    name: "Ali",
    render: ([a, b, c], size) => (
      <span className={`bg-white px-1 ${size} font-semibold text-slate-900`}>
        {a} <span className="text-slate-400">{b} {c}</span>
      </span>
    ),
  },
};

export function TemplatePicker({
  value,
  onChange,
  sample,
}: {
  value: CaptionTemplate;
  onChange: (value: CaptionTemplate) => void;
  /** Three words of the clip to preview each template with, shown larger. */
  sample?: Sample;
}) {
  const t = useDictionary();
  return (
    <div role="radiogroup" aria-label={t.create.captionTemplate} className="grid grid-cols-3 gap-3">
      {(Object.keys(PREVIEWS) as CaptionTemplate[]).map((key) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            className={`state-layer focus-ring flex flex-col gap-2 rounded-md border-2 p-2 text-left ${
              selected
                ? "border-primary bg-secondary-container text-on-secondary-container"
                : "border-transparent bg-surface-container-high text-on-surface"
            }`}
          >
            {/* Fixed dark backdrop: it stands in for video, so it does not follow the theme. */}
            <span
              className={`flex w-full items-center justify-center rounded-sm bg-[#1f1d24] px-1 ${sample ? "h-20" : "h-16 sm:h-20"}`}
            >
              {PREVIEWS[key].render(sample ?? DEFAULT_SAMPLES[key], sample ? "text-sm" : "text-[11px]")}
            </span>
            <span className="flex items-center gap-1 px-1 text-label-l">
              {selected && <Icon name="checkCircle" size={16} className="shrink-0 text-primary" />}
              {PREVIEWS[key].name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
