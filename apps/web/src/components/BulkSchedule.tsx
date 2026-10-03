"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { planSlots, wibDayStart, type BusyMap } from "@clipper/shared/schedule";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { scheduleClips, type ScheduleCode } from "@/lib/schedule-actions";
import { fromWibInputs, relativeDay, wibClock, wibDay, wibInputs } from "@/lib/schedule-format";
import { Segmented } from "./controls";
import { fieldLabel } from "./PostToYouTube";
import { Icon } from "./ui/Icon";

export type BulkClip = {
  id: string;
  title: string;
  score: number | null;
  length: string;
  thumb?: string;
  /** Not yet posted or queued, and has a file. */
  selectable: boolean;
  defaultTitle: string;
  defaultDescription: string;
};

type Labels = { bulk: Dictionary["bulk"]; youtube: Dictionary["youtube"] };

type Selection = {
  selecting: boolean;
  selected: string[];
  selectable: Set<string>;
  start: () => void;
  stop: () => void;
  toggle: (id: string) => void;
  openDialog: () => void;
  labels: Labels;
};

const SelectionContext = createContext<Selection | null>(null);

/** The selection, or null outside <BulkSchedule> (scheduling off): the parts then render plainly. */
function useSelection() {
  return useContext(SelectionContext);
}

export type BulkOptions = {
  clips: BulkClip[];
  map: BusyMap;
  /** Times other clips are queued for. */
  taken: string[];
  until: string;
  perDay: 1 | 2;
  peakOnly: boolean;
};

/**
 * "Schedule several" on the project page: pick clips on the grid, then plan
 * them one or two a day at busy hours. Wraps the page so the summary button,
 * the selection bar and the cards share the selection. Without options
 * (scheduling off, or YouTube not connected) it renders the page as is.
 */
export function BulkSchedule({
  options,
  labels,
  locale,
  children,
}: {
  options: BulkOptions | null;
  labels: Labels;
  locale: string;
  children: React.ReactNode;
}) {
  return options ? (
    <Bulk options={options} labels={labels} locale={locale}>
      {children}
    </Bulk>
  ) : (
    <>{children}</>
  );
}

function Bulk({
  options: { clips, map, taken, until, perDay, peakOnly },
  labels,
  locale,
  children,
}: {
  options: BulkOptions;
  labels: Labels;
  locale: string;
  children: React.ReactNode;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const selectable = useMemo(() => new Set(clips.filter((c) => c.selectable).map((c) => c.id)), [clips]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const value: Selection = {
    selecting,
    selected,
    selectable,
    start: () => {
      setSelected([]);
      setSelecting(true);
    },
    stop: () => {
      setSelecting(false);
      setSelected([]);
    },
    toggle: (id) =>
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : selectable.has(id) ? [...s, id] : s)),
    openDialog: () => setDialogOpen(true),
    labels,
  };

  // Highest score first, the order they go up in.
  const chosen = clips
    .filter((c) => selected.includes(c.id))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <BulkDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDone={(count) => {
          setDialogOpen(false);
          setSelecting(false);
          setSelected([]);
          setToast(fill(labels.bulk.scheduled, { n: count }));
        }}
        clips={chosen}
        map={map}
        taken={taken}
        until={until}
        perDay={perDay}
        peakOnly={peakOnly}
        labels={labels}
        locale={locale}
      />
      {toast && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-30 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2 rounded-xs bg-inverse-surface py-1 pr-2 pl-4 text-body-m text-inverse-on-surface shadow-elev-3 md:bottom-6"
        >
          <span className="flex-1 py-2">{toast}</span>
          <Link
            href="/schedule"
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-inverse-primary"
          >
            {labels.bulk.viewSchedule}
          </Link>
        </div>
      )}
    </SelectionContext.Provider>
  );
}

/** The tonal "Schedule several" button in the project summary. */
export function BulkScheduleButton() {
  const selection = useSelection();
  if (!selection || selection.selecting || selection.selectable.size < 2) return null;
  const { start, labels } = selection;
  return (
    <button
      type="button"
      onClick={start}
      className="state-layer focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-secondary-container pr-6 pl-4 text-label-l text-on-secondary-container"
    >
      <Icon name="calendarMonth" size={20} />
      {labels.bulk.start}
    </button>
  );
}

/** Shown in place of the sort toolbar while picking clips. */
export function SelectionBar() {
  const selection = useSelection();
  if (!selection?.selecting) return null;
  const { selected, stop, openDialog, labels } = selection;
  const n = selected.length;
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg bg-secondary-container py-2 pr-2 pl-4 text-on-secondary-container">
      <Icon name="checkBox" />
      <p className="min-w-0 flex-1 truncate text-title-m">{fill(labels.bulk.selected, { n })}</p>
      <button
        type="button"
        onClick={stop}
        className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary"
      >
        {labels.bulk.cancel}
      </button>
      <button type="button" onClick={openDialog} disabled={n === 0} className="btn-primary pl-4">
        <Icon name="calendarMonth" size={20} />
        <span className="hidden sm:inline">{fill(labels.bulk.submit, { n })}</span>
        <span className="sm:hidden">{labels.youtube.schedule}</span>
      </button>
    </div>
  );
}

/** Hides its children (the sort toolbar) while picking clips. */
export function HideWhileSelecting({ children }: { children: React.ReactNode }) {
  return useSelection()?.selecting ? null : <>{children}</>;
}

/** A clip card that gets a checkbox and a selected ring while picking clips. */
export function SelectableClip({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const selection = useSelection();
  if (!selection?.selecting) return <>{children}</>;
  const { selected, selectable, toggle, labels } = selection;
  if (!selectable.has(id)) return <div className="h-full opacity-60">{children}</div>;
  const on = selected.includes(id);
  return (
    <div className="relative h-full">
      {children}
      {on && <span className="pointer-events-none absolute inset-0 rounded-md border-3 border-primary" />}
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={fill(labels.bulk.select, { title })}
        onClick={() => toggle(id)}
        className={`state-layer focus-ring absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-[10px] ${
          on ? "bg-primary-container text-on-primary-container" : "bg-surface-container-lowest text-on-surface-variant"
        }`}
      >
        <Icon name={on ? "checkBox" : "checkBoxBlank"} />
      </button>
    </div>
  );
}

/** J3: pace, start day and visibility, then the plan with a time per clip. */
function BulkDialog({
  open,
  onClose,
  onDone,
  clips,
  map,
  taken,
  until,
  perDay: initialPerDay,
  peakOnly,
  labels,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
  clips: BulkClip[];
  map: BusyMap;
  taken: string[];
  until: string;
  perDay: 1 | 2;
  peakOnly: boolean;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [perDay, setPerDay] = useState<1 | 2>(initialPerDay);
  const [startDay, setStartDay] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { bulk, youtube } = labels;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setNow(new Date());
      setOverrides({});
      setEditing(null);
      setError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const untilDate = useMemo(() => new Date(until), [until]);
  const plan = useMemo(
    () =>
      now
        ? planSlots(map, clips.length, {
            now,
            start: wibDayStart(now, startDay),
            perDay,
            peakOnly,
            taken,
            until: untilDate,
          })
        : [],
    [now, map, clips.length, startDay, perDay, peakOnly, taken, untilDate],
  );
  const times = clips.map((c, i) => overrides[c.id] ?? plan[i]?.toISOString());
  const complete = times.every(Boolean);
  const startDays = now
    ? Array.from({ length: 14 }, (_, i) => wibDayStart(now, i)).filter((d) => d <= untilDate)
    : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || !complete) return;
    const privacy = String(new FormData(e.currentTarget).get("privacy") ?? "") as "public" | "unlisted" | "private";
    setSending(true);
    setError(null);
    try {
      const results = await scheduleClips(
        clips.map((c, i) => ({ clipId: c.id, at: times[i]!, title: c.defaultTitle, description: c.defaultDescription })),
        privacy,
      );
      const failed = results.filter((r) => !r.ok);
      router.refresh();
      if (!failed.length) {
        onDone(results.length);
        return;
      }
      const code: ScheduleCode = !failed[0].ok ? failed[0].code : "failed";
      setError(`${fill(bulk.someFailed, { n: failed.length })} ${youtube.errors[code] ?? ""}`.trim());
    } catch {
      setError(youtube.errors.failed);
    } finally {
      setSending(false);
    }
  }

  const n = clips.length;
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(e) => sending && e.preventDefault()}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-xl bg-surface-container-high p-0 text-on-surface shadow-elev-3 backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-headline-s">{fill(bulk.title, { n })}</h2>
          <p className="text-body-m text-on-surface-variant">{bulk.intro}</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-title-s">{bulk.rhythm}</p>
          <Segmented
            label={bulk.rhythm}
            value={String(perDay) as "1" | "2"}
            onChange={(v) => {
              setPerDay(v === "2" ? 2 : 1);
              setOverrides({});
            }}
            alwaysCheck
            options={[
              { value: "1", label: bulk.perDay[1] },
              { value: "2", label: bulk.perDay[2] },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <select
              id="bulk-start"
              value={startDay}
              onChange={(e) => {
                setStartDay(Number(e.target.value));
                setOverrides({});
              }}
              className="input h-14 appearance-none pr-10"
            >
              {startDays.map((d, i) => (
                <option key={i} value={i}>
                  {now && (relativeDay(d, now, youtube) ?? wibDay(d, locale))}
                </option>
              ))}
            </select>
            <label htmlFor="bulk-start" className={`${fieldLabel} bg-surface-container-high`}>
              {bulk.startDate}
            </label>
            <Icon
              name="arrowDropDown"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant"
            />
          </div>
          <div className="relative">
            <select id="bulk-privacy" name="privacy" required defaultValue="" className="input h-14 appearance-none pr-10">
              <option value="" disabled>
                {youtube.choosePrivacy}
              </option>
              {(["public", "unlisted", "private"] as const).map((p) => (
                <option key={p} value={p}>
                  {youtube.privacies[p]}
                </option>
              ))}
            </select>
            <label htmlFor="bulk-privacy" className={`${fieldLabel} bg-surface-container-high`}>
              {youtube.privacy}
            </label>
            <Icon
              name="arrowDropDown"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-title-s">{bulk.plan}</p>
          <ul className="flex flex-col rounded-md bg-surface-container-low py-1 pr-2 pl-4">
            {clips.map((c, i) => {
              const at = times[i];
              return (
                <li key={c.id} className="border-outline-variant not-first:border-t">
                  <div className="flex min-h-17 items-center gap-3 py-2.5">
                    <Thumb src={c.thumb} className="h-12 w-[27px] rounded-xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-title-s">{c.title}</p>
                      <p className="text-body-s text-on-surface-variant tabular-nums">
                        {[c.score != null && fill(bulk.score, { n: Math.round(c.score) }), c.length]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {at && (
                      <div className="flex shrink-0 flex-col items-end">
                        <span className="text-body-s text-on-surface-variant">{wibDay(at, locale, "short")}</span>
                        <span className="text-title-m tabular-nums">{wibClock(at, locale)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={fill(bulk.editTime, { title: c.title })}
                      aria-expanded={editing === c.id}
                      onClick={() => setEditing(editing === c.id ? null : c.id)}
                      className="state-layer focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
                    >
                      <Icon name="edit" />
                    </button>
                  </div>
                  {editing === c.id && (
                    <TimeEditor
                      value={at}
                      until={until}
                      labels={youtube}
                      done={bulk.done}
                      onChange={(iso) => setOverrides((o) => ({ ...o, [c.id]: iso }))}
                      onDone={() => setEditing(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {now && !complete && (
          <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
            <Icon name="error" size={20} className="shrink-0" />
            {bulk.notEnough}
          </p>
        )}
        {error && (
          <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
            <Icon name="error" size={20} className="shrink-0" />
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
          >
            {bulk.cancel}
          </button>
          <button className="btn-primary pl-4" disabled={sending || !complete}>
            <Icon name="calendarMonth" size={20} />
            {fill(bulk.submit, { n })}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Date and time inputs (WIB) for one planned clip. */
function TimeEditor({
  value,
  until,
  labels,
  done,
  onChange,
  onDone,
}: {
  value?: string;
  until: string;
  labels: Dictionary["youtube"];
  done: string;
  onChange: (iso: string) => void;
  onDone: () => void;
}) {
  const [fields, setFields] = useState(() => (value ? wibInputs(value) : { date: "", time: "" }));
  function update(next: { date: string; time: string }) {
    setFields(next);
    const at = fromWibInputs(next.date, next.time);
    if (at) onChange(at.toISOString());
  }
  const label = `${fieldLabel} bg-surface-container-low`;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 pb-3">
      <div className="relative min-w-36 flex-1">
        <input
          id="bulk-edit-date"
          type="date"
          value={fields.date}
          min={wibInputs(new Date()).date}
          max={wibInputs(until).date}
          onChange={(e) => update({ ...fields, date: e.target.value })}
          className="input h-12"
        />
        <label htmlFor="bulk-edit-date" className={label}>
          {labels.date}
        </label>
      </div>
      <div className="relative w-32">
        <input
          id="bulk-edit-time"
          type="time"
          value={fields.time}
          onChange={(e) => update({ ...fields, time: e.target.value })}
          className="input h-12"
        />
        <label htmlFor="bulk-edit-time" className={label}>
          {labels.time}
        </label>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary"
      >
        {done}
      </button>
    </div>
  );
}

/** A 9:16 clip thumbnail, or a plain tile when the clip has none. */
export function Thumb({ src, className }: { src?: string; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`shrink-0 bg-surface-container-highest object-cover ${className}`} />
  ) : (
    <span className={`shrink-0 bg-linear-to-b from-primary-container to-tertiary-container ${className}`} />
  );
}
