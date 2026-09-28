"use client";

import type { CaptionTemplate } from "@clipper/shared";
import { useDictionary } from "@/lib/i18n/client";
import { Icon } from "./ui/Icon";

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
            className={`state-layer focus-ring flex flex-col gap-2 rounded-md border-2 p-2 text-left ${
              selected
                ? "border-primary bg-secondary-container text-on-secondary-container"
                : "border-transparent bg-surface-container-high text-on-surface"
            }`}
          >
            {/* Fixed dark backdrop: it stands in for video, so it does not follow the theme. */}
            <span className="flex h-16 w-full items-center justify-center rounded-sm bg-[#1f1d24] px-1 sm:h-20">
              {PREVIEWS[key].render()}
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
