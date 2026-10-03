"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LEARN_AFTER, suggestSlots, type BusyMap, type Slot } from "@clipper/shared/schedule";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { scheduleClips, type ScheduleCode } from "@/lib/schedule-actions";
import { fromWibInputs, slotTitle, wibClock, wibDay, wibInputs } from "@/lib/schedule-format";
import { Segmented } from "./controls";
import { Icon } from "./ui/Icon";

type Labels = Dictionary["youtube"];
type Privacy = "public" | "unlisted" | "private";
type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "scheduling" }
  | { kind: "done"; url: string }
  | { kind: "error"; message: string };

/** What the dialog needs to suggest times. Null when scheduling is off. */
export type Scheduling = {
  map: BusyMap;
  /** Times other clips are queued for. */
  taken: string[];
  /** The latest time this clip can be scheduled for. */
  until: string;
};

/** A post already in the queue for this clip. */
export type QueuedPost = { at: string; title: string; description: string; privacy: Privacy };

/** The label resting on an outlined field's border; add the background it sits on. */
export const fieldLabel = "pointer-events-none absolute -top-2 left-3 px-1 text-body-s text-on-surface-variant";
// The dialog is full-screen on the surface colour on compact windows.
const outlinedLabel = `${fieldLabel} bg-surface sm:bg-surface-container-high`;

/** The clip card's "Post to YouTube" button (or its scheduled time) and the post dialog. */
export function PostToYouTube({
  clipId,
  defaultTitle,
  defaultDescription,
  postedUrl,
  queued,
  scheduling,
  labels,
  locale,
}: {
  clipId: string;
  defaultTitle: string;
  defaultDescription: string;
  postedUrl?: string;
  queued?: QueuedPost;
  scheduling: Scheduling | null;
  labels: Labels;
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const [posted, setPosted] = useState(postedUrl);

  if (posted) {
    return (
      <a href={posted} target="_blank" rel="noreferrer" className="btn-secondary w-full">
        <Icon name="checkCircle" size={18} />
        {labels.view}
      </a>
    );
  }

  const when = queued ? `${wibDay(queued.at, locale, "short")} · ${wibClock(queued.at, locale)}` : "";
  return (
    <>
      {queued ? (
        <button
          type="button"
          className="btn-secondary w-full px-3"
          title={fill(labels.scheduled, { when })}
          onClick={() => setOpen(true)}
        >
          <Icon name="calendarMonth" size={18} />
          <span className="sr-only">{labels.scheduledShort}</span>
          <span className="truncate">{when}</span>
        </button>
      ) : (
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          <Icon name="share" size={18} />
          {labels.post}
        </button>
      )}
      <PostDialog
        open={open}
        onClose={() => setOpen(false)}
        onPosted={setPosted}
        clipId={clipId}
        initial={queued ?? { title: defaultTitle, description: defaultDescription }}
        scheduling={scheduling}
        labels={labels}
        locale={locale}
      />
    </>
  );
}

/**
 * Post dialog (M3 basic dialog; full-screen on compact windows): title,
 * description, visibility, and either post now or schedule at a suggested
 * time. With `initial.at` it edits a queued post.
 */
export function PostDialog({
  open,
  onClose,
  onPosted,
  clipId,
  initial,
  scheduling,
  labels,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  onPosted?: (url: string) => void;
  clipId: string;
  /** `at` edits a queued post; `later` opens on scheduling without a time picked yet. */
  initial: { title: string; description: string; privacy?: Privacy; at?: string; later?: boolean };
  scheduling: Scheduling | null;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [mode, setMode] = useState<"now" | "later">(
    (initial.at || initial.later) && scheduling ? "later" : "now",
  );
  // Suggestions depend on the clock, so they are worked out when the dialog opens.
  const [now, setNow] = useState<Date | null>(null);
  const [choice, setChoice] = useState<number | "custom">(initial.at ? "custom" : 0);
  const [custom, setCustom] = useState(() => (initial.at ? wibInputs(initial.at) : { date: "", time: "" }));
  // Blocks a second submit before React has re-rendered the disabled button.
  const sending = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setNow(new Date());
      setState({ kind: "idle" });
      d.showModal();
      // Start on the dialog itself rather than the title field, so opening it
      // doesn't put a caret (or, on phones, the keyboard) in the title.
      d.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  const slots: Slot[] = useMemo(
    () =>
      scheduling && now
        ? suggestSlots(scheduling.map, { now, taken: scheduling.taken, until: new Date(scheduling.until) })
        : [],
    [scheduling, now],
  );

  function chooseCustom() {
    setChoice("custom");
    if (!custom.date) {
      const base = slots[0]?.at ?? new Date(Date.now() + 3600_000);
      setCustom(wibInputs(base));
    }
  }

  // A plain submit handler rather than a form action: inside an action React
  // holds the "uploading" state until the upload returns, so the button stayed
  // clickable and a second click posted the clip twice.
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    const form = new FormData(e.currentTarget);
    const fields = {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      privacy: String(form.get("privacy") ?? "") as Privacy,
    };

    if (mode === "later") {
      const at = choice === "custom" ? fromWibInputs(custom.date, custom.time) : slots[choice]?.at;
      if (!at) {
        setState({ kind: "error", message: labels.errors.badTime });
        return;
      }
      sending.current = true;
      setState({ kind: "scheduling" });
      try {
        const [result] = await scheduleClips(
          [{ clipId, at: at.toISOString(), title: fields.title, description: fields.description }],
          fields.privacy,
        );
        if (result?.ok) {
          setState({ kind: "idle" });
          onClose();
          router.refresh();
        } else {
          const code: ScheduleCode = result && !result.ok ? result.code : "failed";
          setState({ kind: "error", message: labels.errors[code] ?? labels.errors.failed });
          if (code === "reconnect") router.refresh();
        }
      } catch {
        setState({ kind: "error", message: labels.errors.failed });
      } finally {
        sending.current = false;
      }
      return;
    }

    sending.current = true;
    setState({ kind: "uploading" });
    try {
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId, ...fields }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; code?: string };
      if (res.ok && json.url) {
        setState({ kind: "done", url: json.url });
        onPosted?.(json.url);
        onClose();
        router.refresh();
        return;
      }
      const code = json.code as keyof Labels["errors"];
      setState({ kind: "error", message: labels.errors[code] ?? labels.errors.failed });
      if (code === "reconnect") window.location.reload();
    } catch {
      setState({ kind: "error", message: labels.errors.failed });
    } finally {
      sending.current = false;
    }
  }

  const busy = state.kind === "uploading" || state.kind === "scheduling";
  const later = mode === "later" && scheduling;
  const submitLabel = later ? labels.schedule : labels.submit;
  const id = (name: string) => `yt-${name}-${clipId}`;
  const learned = scheduling?.map.learned;
  const samples = scheduling?.map.samples ?? 0;

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-label={labels.dialogTitle}
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-surface p-0 text-on-surface outline-none backdrop:bg-black/40 sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-32px)] sm:w-[min(560px,calc(100vw-32px))] sm:rounded-xl sm:bg-surface-container-high sm:shadow-elev-3"
    >
      <form onSubmit={submit} className="flex min-h-full flex-col sm:min-h-0">
        {/* Compact windows: full-screen dialog with the action in the top bar. */}
        <div className="sticky top-0 z-10 flex h-16 items-center gap-1 bg-surface px-1 sm:hidden">
          <button
            type="button"
            aria-label={labels.cancel}
            disabled={busy}
            onClick={onClose}
            className="state-layer focus-ring flex h-12 w-12 items-center justify-center rounded-full text-on-surface"
          >
            <Icon name="close" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-title-l">{labels.dialogTitle}</h2>
          <button
            disabled={busy}
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
          >
            {submitLabel}
          </button>
        </div>

        <div className="flex flex-col gap-5 px-4 pt-2 pb-6 sm:p-6">
          <h2 className="hidden text-headline-s sm:block">{labels.dialogTitle}</h2>
          <div className="relative">
            <input
              id={id("title")}
              name="title"
              required
              maxLength={100}
              defaultValue={initial.title}
              className="input h-14"
              disabled={busy}
            />
            <label htmlFor={id("title")} className={outlinedLabel}>
              {labels.title}
            </label>
          </div>
          <div className="relative">
            <textarea
              id={id("desc")}
              name="description"
              rows={3}
              maxLength={4900}
              defaultValue={initial.description}
              className="input resize-y"
              disabled={busy}
            />
            <label htmlFor={id("desc")} className={outlinedLabel}>
              {labels.description}
            </label>
          </div>
          <div className="relative">
            <select
              id={id("privacy")}
              name="privacy"
              required
              defaultValue={initial.privacy ?? ""}
              className="input h-14 appearance-none pr-10"
              disabled={busy}
            >
              <option value="" disabled>
                {labels.choosePrivacy}
              </option>
              {(["public", "unlisted", "private"] as const).map((p) => (
                <option key={p} value={p}>
                  {labels.privacies[p]}
                </option>
              ))}
            </select>
            <label htmlFor={id("privacy")} className={outlinedLabel}>
              {labels.privacy}
            </label>
            <Icon
              name="arrowDropDown"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant"
            />
          </div>

          {scheduling && (
            <div className="flex flex-col gap-2">
              <p className="text-title-s">{labels.when}</p>
              <Segmented
                label={labels.when}
                value={mode}
                onChange={setMode}
                alwaysCheck
                options={[
                  { value: "now", label: labels.now },
                  { value: "later", label: labels.later },
                ]}
              />
            </div>
          )}

          {later && (
            <>
              <fieldset className="flex flex-col gap-2" disabled={busy}>
                <legend className="mb-2 text-title-s">{labels.suggestions}</legend>
                {now &&
                  slots.map((slot, i) => (
                    <SlotOption
                      key={slot.at.toISOString()}
                      name={id("slot")}
                      checked={choice === i}
                      onSelect={() => setChoice(i)}
                      title={slotTitle(slot.at, now, locale, labels)}
                      detail={slotDetail(slot, now, locale, labels)}
                      badge={slot.best ? labels.bestBadge : undefined}
                    />
                  ))}
                {choice === "custom" ? (
                  <div className="mt-2 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
                    <div className="relative">
                      <input
                        id={id("date")}
                        type="date"
                        required
                        value={custom.date}
                        min={wibInputs(new Date()).date}
                        max={wibInputs(scheduling.until).date}
                        onChange={(e) => setCustom((c) => ({ ...c, date: e.target.value }))}
                        className="input h-14"
                      />
                      <label htmlFor={id("date")} className={outlinedLabel}>
                        {labels.date}
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        id={id("time")}
                        type="time"
                        required
                        value={custom.time}
                        onChange={(e) => setCustom((c) => ({ ...c, time: e.target.value }))}
                        className="input h-14"
                      />
                      <label htmlFor={id("time")} className={outlinedLabel}>
                        {labels.time}
                      </label>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={chooseCustom}
                    className="state-layer focus-ring inline-flex h-10 items-center gap-2 self-start rounded-full px-3 text-label-l text-primary"
                  >
                    <Icon name="calendarMonth" size={20} />
                    {labels.otherTime}
                  </button>
                )}
              </fieldset>
              <p className="flex gap-3 rounded-md bg-surface-container-low px-4 py-3 text-body-s text-on-surface-variant">
                <Icon name="info" size={20} className="shrink-0" />
                {learned
                  ? fill(labels.noteLearned, { n: samples })
                  : fill(labels.noteGeneric, { n: samples, total: LEARN_AFTER })}
              </p>
            </>
          )}

          {state.kind === "uploading" && (
            <div role="status" className="flex flex-col gap-2">
              <div className="relative h-1 overflow-hidden rounded-full bg-secondary-container">
                <span className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
              <p className="text-body-m">{labels.uploading}</p>
              <p className="text-body-s text-on-surface-variant">{labels.uploadingHint}</p>
            </div>
          )}
          {state.kind === "error" && (
            <p
              role="alert"
              className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container"
            >
              <Icon name="error" size={20} className="shrink-0" />
              {state.message}
            </p>
          )}

          <div className="hidden justify-end gap-2 sm:flex">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary disabled:text-on-surface/38"
            >
              {labels.cancel}
            </button>
            <button className="btn-primary pl-4" disabled={busy}>
              {later && <Icon name="schedule" size={20} />}
              {submitLabel}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/** "Kamis, 1 Okt. Jam paling ramai penontonmu" under today/tomorrow; just the reason further out. */
function slotDetail(slot: Slot, now: Date, locale: string, labels: Labels) {
  const reason = slot.reason ? labels.reasons[slot.reason] : "";
  if (slot.days > 1) return reason;
  const day = wibDay(slot.at, locale);
  return reason ? `${day}. ${reason}` : day;
}

/** One suggested time: an M3 radio button on a selectable card. */
function SlotOption({
  name,
  checked,
  onSelect,
  title,
  detail,
  badge,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  badge?: string;
}) {
  return (
    <label
      className={`state-layer flex min-h-16 cursor-pointer items-center gap-3 rounded-md py-3 pr-4 pl-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-secondary ${
        checked ? "bg-secondary-container text-on-secondary-container" : "border border-outline-variant"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
            checked ? "border-primary" : "border-on-surface-variant"
          }`}
        >
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-title-m ${checked ? "" : "text-on-surface"}`}>{title}</span>
        {detail && (
          <span className={`text-body-s ${checked ? "" : "text-on-surface-variant"}`}>{detail}</span>
        )}
      </span>
      {badge && (
        <span className="shrink-0 rounded-[6px] bg-tertiary-container px-2 py-0.5 text-label-m text-on-tertiary-container">
          {badge}
        </span>
      )}
    </label>
  );
}
