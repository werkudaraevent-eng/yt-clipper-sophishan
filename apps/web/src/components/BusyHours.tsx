import { BLOCK_STARTS, LEARN_AFTER, type BusyMap } from "@clipper/shared/schedule";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { Icon } from "./ui/Icon";

type Labels = Dictionary["schedule"];

/** Opacity of the primary colour over a cell: quiet slots stay faint, the busiest is solid. */
const heat = (v: number) => 0.2 + 0.8 * v;

/** J4: the channel's busy hours as a weekday × time-of-day heatmap, best slots starred. */
export function BusyHours({ map, labels }: { map: BusyMap; labels: Labels }) {
  const isBest = (d: number, b: number) => map.best.some(([bd, bb]) => bd === d && bb === b);
  const hour = (b: number) => String(BLOCK_STARTS[b]).padStart(2, "0");
  const bestText = map.best.map(([d, b]) => `${labels.days[d]} ${hour(b)}`).join(", ");
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-surface-container-low px-6 py-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-title-m text-on-surface">{labels.busyTitle}</h3>
        <p className="text-body-s text-on-surface-variant">{fill(labels.busyIntro, { n: map.samples })}</p>
      </div>
      <div
        role="img"
        aria-label={`${labels.busyTitle}. ${labels.bestSlot.replace("★ ", "")}: ${bestText}`}
        className="grid grid-cols-[32px_repeat(6,minmax(0,1fr))] gap-1"
      >
        <span />
        {BLOCK_STARTS.map((_, b) => (
          <span key={b} className="text-center text-label-s text-on-surface-variant tabular-nums">
            {hour(b)}
          </span>
        ))}
        {map.cells.map((row, d) => (
          <div key={d} className="contents">
            <span className="flex h-7 items-center text-body-s text-on-surface-variant">{labels.days[d]}</span>
            {row.map((v, b) => (
              <span
                key={b}
                className="relative flex h-7 items-center justify-center overflow-hidden rounded-xs bg-surface-container-lowest"
              >
                <span className="absolute inset-0 bg-primary" style={{ opacity: heat(v) }} />
                {isBest(d, b) && <span className="relative text-label-m text-on-primary">★</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-body-s text-on-surface-variant" aria-hidden>
        {labels.quiet}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <span key={v} className="h-3 w-5 rounded-[3px] bg-primary" style={{ opacity: heat(v) }} />
        ))}
        {labels.busy}
        <span className="ml-auto">{labels.bestSlot}</span>
      </div>
    </section>
  );
}

/** J4m: shown until the channel has enough Shorts with views to learn from. */
export function LearningCard({ samples, labels }: { samples: number; labels: Labels }) {
  const progress = Math.min(samples / LEARN_AFTER, 1);
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-secondary-container p-4 text-on-secondary-container">
      <h3 className="flex items-center gap-2 text-title-m">
        <Icon name="wand" size={20} />
        {labels.learningTitle}
      </h3>
      <p className="text-body-s">{fill(labels.learningBody, { total: LEARN_AFTER })}</p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={LEARN_AFTER}
        aria-valuenow={Math.min(samples, LEARN_AFTER)}
        className="flex h-1 items-center gap-1"
      >
        {progress > 0 && <span className="h-1 rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />}
        <span className="flex h-1 flex-1 items-center justify-end">
          <span className="h-1 w-1 rounded-full bg-primary" />
        </span>
      </div>
      <p className="text-body-s">{fill(labels.learningProgress, { n: Math.min(samples, LEARN_AFTER), total: LEARN_AFTER })}</p>
    </section>
  );
}
