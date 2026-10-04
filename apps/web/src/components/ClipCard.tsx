import { Icon } from "./ui/Icon";

/**
 * A 9:16 clip on an M3 outlined card: media with the virality score and
 * length on top, then title, hook, source range and the download action,
 * with the edit button beside it.
 */
export function ClipCard({
  media,
  score,
  length,
  title,
  hook,
  range,
  downloadHref,
  downloadLabel,
  edit,
  overlay,
  edited,
  note,
  actions,
  className = "",
}: {
  media: React.ReactNode;
  score?: number | null;
  length?: string;
  title: string;
  hook?: string | null;
  range: string;
  downloadHref?: string;
  downloadLabel: string;
  /** Icon button beside the download, to edit the clip. */
  edit?: React.ReactNode;
  /** Laid over the media, e.g. while an edit renders. */
  overlay?: React.ReactNode;
  /** "Edited" after the range, once the clip has been edited. */
  edited?: string;
  /** A line under the range, e.g. that the last edit failed. */
  note?: string;
  /** Extra buttons under the download, e.g. posting to YouTube. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-md border border-outline-variant bg-surface-container-low ${className}`}
    >
      <div className="relative aspect-[9/16] w-full bg-black">
        {media}
        {score != null && (
          <span className="pointer-events-none absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-sm bg-tertiary-container pr-2 pl-1.5 text-label-m text-on-tertiary-container">
            <Icon name="fire" size={14} />
            {Math.round(score)}
          </span>
        )}
        {length && (
          <span className="pointer-events-none absolute top-2 right-2 rounded-xs bg-black/70 px-1.5 py-0.5 text-label-m text-white tabular-nums">
            {length}
          </span>
        )}
        {overlay}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-title-s text-on-surface">{title}</h3>
        {hook && <p className="line-clamp-2 text-body-s text-on-surface-variant">“{hook}”</p>}
        <p className="mt-1 flex flex-wrap items-center gap-1 text-body-s text-on-surface-variant tabular-nums">
          <Icon name="schedule" size={14} />
          {range}
          {edited && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-label-m text-primary">
                <Icon name="edit" size={14} />
                {edited}
              </span>
            </>
          )}
        </p>
        {note && <p className="text-body-s text-error">{note}</p>}
        <div className="mt-auto flex flex-col gap-2 pt-3">
          <div className="flex items-center gap-1">
            {downloadHref ? (
              <a href={downloadHref} className="btn-primary min-w-0 flex-1">
                <Icon name="download" size={18} />
                {downloadLabel}
              </a>
            ) : (
              <button type="button" className="btn-primary min-w-0 flex-1" disabled>
                <Icon name="download" size={18} />
                {downloadLabel}
              </button>
            )}
            {edit}
          </div>
          {actions}
        </div>
      </div>
    </article>
  );
}

/** Stand-in media for sample clips: a fixed gradient with a burned-in caption. */
export function SampleMedia({ gradient, caption }: { gradient: string; caption: [string, string] }) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-end pb-[22%] ${gradient}`}>
      <span className="absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/25 text-white">
        <Icon name="play" />
      </span>
      <span className="px-2 text-center text-sm leading-tight font-extrabold text-white uppercase [text-shadow:0_1px_3px_rgb(0_0_0/0.6)] sm:text-base">
        {caption[0]}
        <br />
        <span className="text-[#FFD60A]">{caption[1]}</span>
      </span>
    </div>
  );
}
