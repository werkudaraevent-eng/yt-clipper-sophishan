"use client";

import type { CaptionTemplate } from "@clipper/shared";
import { useDictionary } from "@/lib/i18n/client";

const PREVIEWS: Record<CaptionTemplate, { name: string; render: () => React.ReactNode }> = {
  karaoke: {
    name: "Karaoke",
    render: () => (
      <span className="text-center text-[11px] leading-tight font-black text-white uppercase [text-shadow:0_0_3px_#000,0_0_3px_#000]">
        and <span className="text-[#39FF14]">the</span>
        <br />
        problem
      </span>
    ),
  },
  box: {
    name: "Box",
    render: () => (
      <span className="text-[11px] font-black text-white uppercase [text-shadow:0_0_2px_#000]">
        big step <span className="bg-[#E0245E] px-0.5">changes</span>
      </span>
    ),
  },
  ali: {
    name: "Ali",
    render: () => (
      <span className="bg-white px-1 text-[11px] font-semibold text-slate-900">
        the <span className="text-slate-400">same way</span>
      </span>
    ),
  },
};

export function TemplatePicker({
  value,
  onChange,
}: {
  value: CaptionTemplate;
  onChange: (value: CaptionTemplate) => void;
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
            className="flex flex-col items-center gap-1"
          >
            <span
              className={`flex aspect-[9/16] w-full items-end justify-center rounded-md bg-gradient-to-b from-slate-600 to-slate-900 pb-[30%] ${
                selected ? "ring-3 ring-accent" : ""
              }`}
            >
              {PREVIEWS[key].render()}
            </span>
            <span className={`text-xs ${selected ? "font-semibold text-accent" : "text-muted"}`}>
              {PREVIEWS[key].name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
