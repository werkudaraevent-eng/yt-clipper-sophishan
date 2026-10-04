"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  CAPTION_POSITIONS,
  LAYOUTS,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  TRIM_REACH_SECONDS,
  captionLines,
  countMatches,
  lineText,
  replaceAll,
  retimeLine,
  spokenEnd,
  type CaptionWord,
  type ClipEdit,
  type ClipLook,
  type ClipStyle,
} from "@clipper/shared";
import { Segmented, Switch } from "@/components/controls";
import { TemplatePicker } from "@/components/TemplatePicker";
import { Icon, type IconName } from "@/components/ui/Icon";
import { deleteTerm, saveClipEdit, saveTerm, type TermCode } from "@/lib/clip-edit-actions";
import { shortClock, tenths } from "@/lib/format";
import { type Dictionary, fill } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/client";

export type Term = { id: number; wrong: string; correct: string };

export type EditorClip = {
  id: string;
  title: string;
  position: number;
  /** How many clips the project has. */
  count: number;
  hook: string;
  start: number;
  end: number;
  /** The AI's cut; a trim stays within TRIM_REACH_SECONDS of it. */
  aiStart: number;
  aiEnd: number;
  /** Where the source video ends, when known. */
  sourceEnd: number | null;
  words: CaptionWord[];
  look: ClipLook;
  /** Rendered before the editor: its cold open is found again when it is saved. */
  legacy: boolean;
  video?: string;
  thumb?: string;
};

type Tab = "caption" | "trim" | "style";
type Look = Required<ClipStyle>;
type Line = { words: CaptionWord[]; from: number; to: number };

const STYLE_KEYS = ["template", "position", "wordsPerCaption", "layout", "hookTitle", "coldOpen"] as const;
const STEP_SECONDS = 0.5;
// A dragged handle jumps to a pause between sentences this close to it.
const SNAP_SECONDS = 0.8;
// A cold open has to start this far into the clip (TEASER_LEAD_SECONDS in the worker).
const TEASER_LEAD_SECONDS = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;
const wordKey = (w: CaptionWord) => `${w.start}|${w.text}`;
const bare = (text: string) => text.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

function sameWords(a: CaptionWord[], b: CaptionWord[]) {
  return a.length === b.length && a.every((w, i) => wordKey(w) === wordKey(b[i]) && w.end === b[i].end);
}

/**
 * The clip editor (Figma "Edit klip"): the current render on the left, and
 * tabs for captions, the cut and the look. Saving queues a re-render.
 */
export function ClipEditor({
  clip,
  buyer,
  terms: initialTerms,
  cheapest,
  busy,
  projectHref,
  locale,
}: {
  clip: EditorClip;
  /** Has bought credits: may re-cut, restyle and keep a name dictionary. */
  buyer: boolean;
  terms: Term[];
  /** The cheapest pack, for the upsell on locked tabs. */
  cheapest: { price: string; credits: number } | null;
  /** An earlier edit is still rendering. */
  busy: boolean;
  projectHref: string;
  locale: string;
}) {
  const t = useDictionary();
  const e = t.editor;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("caption");
  const [hook, setHook] = useState(clip.hook);
  const [words, setWords] = useState(clip.words);
  const [range, setRange] = useState<[number, number]>([clip.start, clip.end]);
  const initialLook = useMemo(
    () => Object.fromEntries(STYLE_KEYS.map((k) => [k, clip.look[k]])) as Look,
    [clip.look],
  );
  const [look, setLook] = useState<Look>(initialLook);
  const [styleToAll, setStyleToAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // The edit as edit_clip takes it: only what changed.
  const edit = useMemo(() => {
    const out: ClipEdit = {};
    if (!sameWords(words, clip.words)) out.words = words;
    if (hook.trim() !== clip.hook.trim()) out.hook = hook.trim();
    if (buyer) {
      if (Math.abs(range[0] - clip.start) > 0.01) out.start = range[0];
      if (Math.abs(range[1] - clip.end) > 0.01) out.end = range[1];
      const style = Object.fromEntries(STYLE_KEYS.filter((k) => look[k] !== initialLook[k]).map((k) => [k, look[k]]));
      if (Object.keys(style).length) out.style = style as ClipStyle;
    }
    return out;
  }, [words, hook, range, look, buyer, clip, initialLook]);
  const changed = Object.keys(edit).length > 0;

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await saveClipEdit(clip.id, edit, styleToAll);
      if (result.ok) router.push(projectHref);
      else setError(e.errors[result.code]);
    });
  }

  // The preview plays the clip's current file, which may open with a teaser.
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [fileLength, setFileLength] = useState(0);
  const [playing, setPlaying] = useState(false);
  const teaserLength = Math.max(0, fileLength - (clip.end - clip.start));
  const playhead = fileLength && time > 0 && time >= teaserLength ? clip.start + time - teaserLength : null;
  function playFrom(sourceSeconds: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, teaserLength + sourceSeconds - clip.start);
    void v.play().catch(() => {});
  }
  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }

  const footer = buyer ? e.footer : e.footerFree;
  const meta = [
    fill(e.clipOf, { n: clip.position + 1, total: clip.count }),
    `${shortClock(clip.start)} – ${shortClock(clip.end)}`,
    shortClock(clip.end - clip.start),
  ].join(" · ");
  const tabs: { id: Tab; icon: IconName; locked: boolean }[] = [
    { id: "caption", icon: "subtitles", locked: false },
    { id: "trim", icon: "cut", locked: !buyer },
    { id: "style", icon: "palette", locked: !buyer },
  ];
  const saveLabel = saving ? e.saving : e.save;

  return (
    <div className="flex flex-col gap-6 pb-20 md:pb-0 xl:flex-row xl:items-start xl:gap-8">
      <section className="flex flex-col gap-3 xl:sticky xl:top-20 xl:w-[360px] xl:shrink-0">
        <div className="relative mx-auto aspect-[9/16] w-[180px] overflow-hidden rounded-lg bg-black md:w-[270px] xl:w-full">
          {clip.video ? (
            <video
              ref={video}
              src={clip.video}
              poster={clip.thumb}
              preload="metadata"
              playsInline
              onClick={toggle}
              onLoadedMetadata={(ev) => setFileLength(ev.currentTarget.duration || 0)}
              onTimeUpdate={(ev) => setTime(ev.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-body-s text-white/70">
              {t.project.notUploaded}
            </div>
          )}
          <span className="pointer-events-none absolute top-3 right-3 rounded-xs bg-black/70 px-1.5 py-0.5 text-label-m text-white tabular-nums">
            {shortClock(clip.end - clip.start)}
          </span>
        </div>
        <div className="flex items-center gap-3 px-0">
          <button
            type="button"
            onClick={toggle}
            disabled={!clip.video}
            aria-label={playing ? e.pause : e.play}
            className="state-layer focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container disabled:opacity-38"
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <span className="shrink-0 text-label-l text-on-surface-variant tabular-nums">
            {shortClock(time)} / {shortClock(fileLength || clip.end - clip.start)}
          </span>
          <Seek
            value={time}
            max={fileLength}
            label={e.seek}
            onSeek={(s) => {
              if (video.current) video.current.currentTime = s;
              setTime(s);
            }}
          />
        </div>
        <p className="text-body-s text-on-surface-variant">{e.previewNote}</p>
      </section>

      <section className="-mx-4 flex min-w-0 flex-1 flex-col md:mx-0 md:overflow-hidden md:rounded-xl md:bg-surface-container-low">
        <header className="flex flex-col gap-0.5 px-4 pb-1 md:gap-1 md:px-8 md:pt-6 md:pb-2">
          <h2 className="text-title-m text-on-surface md:text-title-l">{clip.title}</h2>
          <p className="text-body-s text-on-surface-variant tabular-nums md:text-body-m">{meta}</p>
        </header>
        <div role="tablist" aria-label={e.title} className="flex border-b border-outline-variant md:px-4">
          {tabs.map((x) => {
            const selected = x.id === tab;
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                id={`tab-${x.id}`}
                aria-selected={selected}
                aria-controls={`panel-${x.id}`}
                onClick={() => setTab(x.id)}
                className={`state-layer focus-ring flex min-w-0 flex-1 flex-col items-center md:flex-none ${
                  selected ? "text-primary" : "text-on-surface-variant"
                }`}
              >
                <span className="flex h-[45px] items-center gap-2 px-4 text-label-l whitespace-nowrap">
                  <Icon name={x.icon} size={20} />
                  {e.tabs[x.id]}
                  {x.locked && <Icon name="lock" size={16} title={e.buyersOnly} />}
                </span>
                <span className={`h-[3px] w-full rounded-t-[3px] ${selected ? "bg-primary" : ""}`} />
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-5 px-4 pt-5 pb-6 md:gap-6 md:px-8 md:py-6">
          {busy && (
            <p className="flex gap-2 rounded-md bg-secondary-container p-3 text-body-m text-on-secondary-container">
              <Icon name="hourglass" size={20} className="shrink-0" />
              {e.errors.inProgress}
            </p>
          )}
          {/* Every tab stays mounted, so switching keeps what was typed. */}
          <Panel id="caption" tab={tab}>
            <CaptionTab
              clip={clip}
              buyer={buyer}
              initialTerms={initialTerms}
              hook={hook}
              setHook={setHook}
              words={words}
              setWords={setWords}
              playhead={playhead}
              onPlay={playFrom}
              t={t}
            />
          </Panel>
          <Panel id="trim" tab={tab}>
            <Locked buyer={buyer} cheapest={cheapest} t={t}>
              <TrimTab
                clip={clip}
                range={range}
                setRange={setRange}
                coldOpen={look.coldOpen}
                setColdOpen={(v) => setLook({ ...look, coldOpen: v })}
                playhead={playhead}
                locale={locale}
                t={t}
              />
            </Locked>
          </Panel>
          <Panel id="style" tab={tab}>
            <Locked buyer={buyer} cheapest={cheapest} t={t}>
              <StyleTab
                clip={clip}
                look={look}
                setLook={setLook}
                styleToAll={styleToAll}
                setStyleToAll={setStyleToAll}
                t={t}
              />
            </Locked>
          </Panel>
          {error && (
            <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
              <Icon name="error" size={20} className="shrink-0" />
              {error}
            </p>
          )}
          <p className="flex gap-2 text-body-s text-on-surface-variant md:hidden">
            <Icon name="info" size={18} className="shrink-0" />
            {footer}
          </p>
        </div>

        <footer className="hidden items-center gap-3 border-t border-outline-variant px-8 py-4 md:flex">
          <Icon name="info" size={20} className="text-on-surface-variant" />
          <p className="min-w-0 flex-1 text-body-s text-on-surface-variant">{footer}</p>
          <Link
            href={projectHref}
            className="state-layer focus-ring inline-flex h-10 shrink-0 items-center rounded-full px-3 text-label-l text-primary"
          >
            {e.cancel}
          </Link>
          <button type="button" onClick={save} disabled={!changed || busy || saving} className="btn-primary shrink-0 pr-6 pl-4">
            <Icon name="check" size={20} />
            {saveLabel}
          </button>
        </footer>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-surface-container px-4 py-3 md:hidden">
        <Link
          href={projectHref}
          className="state-layer focus-ring inline-flex h-10 shrink-0 items-center rounded-full px-3 text-label-l text-primary"
        >
          {e.cancel}
        </Link>
        <button type="button" onClick={save} disabled={!changed || busy || saving} className="btn-primary min-w-0 flex-1 pr-6 pl-4">
          <Icon name="check" size={20} />
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function Panel({ id, tab, children }: { id: Tab; tab: Tab; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={id !== tab}
      className="flex flex-col gap-5 md:gap-6"
    >
      {children}
    </div>
  );
}

/** A horizontal scrubber for the preview. */
function Seek({ value, max, label, onSeek }: { value: number; max: number; label: string; onSeek: (s: number) => void }) {
  const at = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    return Math.min(max, Math.max(0, ((x - r.left) / r.width) * max));
  };
  return (
    <div
      role="slider"
      tabIndex={max ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={shortClock(value)}
      onPointerDown={(ev) => {
        if (!max) return;
        ev.currentTarget.setPointerCapture(ev.pointerId);
        onSeek(at(ev.currentTarget, ev.clientX));
      }}
      onPointerMove={(ev) => {
        if (ev.currentTarget.hasPointerCapture(ev.pointerId)) onSeek(at(ev.currentTarget, ev.clientX));
      }}
      onKeyDown={(ev) => {
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
          ev.preventDefault();
          onSeek(Math.min(max, Math.max(0, value + (ev.key === "ArrowRight" ? 5 : -5))));
        }
      }}
      className="focus-ring flex h-6 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-full"
    >
      <span className="h-1 w-full overflow-hidden rounded-[2px] bg-secondary-container">
        <span className="block h-1 rounded-[2px] bg-primary" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </span>
    </div>
  );
}

/** M3 outlined text field with its label resting on the outline. */
function Field({
  label,
  value,
  onChange,
  maxLength,
  className = "",
  labelBg = "bg-surface md:bg-surface-container-low",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  className?: string;
  labelBg?: string;
}) {
  const id = useId();
  return (
    <div className={`relative pt-2 ${className}`}>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(ev) => onChange(ev.target.value)}
        className="input h-14"
      />
      <label
        htmlFor={id}
        className={`pointer-events-none absolute top-0 left-3 px-1 text-body-s text-on-surface-variant ${labelBg}`}
      >
        {label}
      </label>
    </div>
  );
}

/** A checkbox row drawn with the Material check box icons. */
function CheckRow({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="focus-ring flex items-center gap-2 rounded-xs text-left text-body-m text-on-surface disabled:cursor-not-allowed"
    >
      <Icon
        name={checked ? "checkBox" : "checkBoxBlank"}
        size={20}
        className={disabled ? "text-on-surface/38" : checked ? "text-primary" : "text-on-surface-variant"}
      />
      <span className={disabled ? "opacity-38" : undefined}>{label}</span>
    </button>
  );
}

function BuyersChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-tertiary-container py-0.5 pr-2 pl-1.5 text-label-m text-on-tertiary-container">
      <Icon name="lock" size={14} />
      {label}
    </span>
  );
}

/** Free accounts see the buyers' tabs dimmed under an offer of the credit packs. */
function Locked({
  buyer,
  cheapest,
  t,
  children,
}: {
  buyer: boolean;
  cheapest: { price: string; credits: number } | null;
  t: Dictionary;
  children: React.ReactNode;
}) {
  if (buyer) return children;
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container">
            <Icon name="lock" size={20} />
          </span>
          <h3 className="text-title-m text-on-surface">{t.editor.lockedTitle}</h3>
        </div>
        <p className="text-body-m text-on-surface-variant">{t.editor.lockedBody}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link href="/credits" className="btn-primary pr-6 pl-4">
            <Icon name="tollFill" size={20} />
            {t.progress.seePacks}
          </Link>
          {cheapest && (
            <p className="text-body-s text-on-surface-variant">
              {fill(t.editor.fromPrice, { price: cheapest.price, credits: cheapest.credits })}
            </p>
          )}
        </div>
      </div>
      <div inert className="flex flex-col gap-5 opacity-38 select-none md:gap-6">
        {children}
      </div>
    </>
  );
}

function CaptionTab({
  clip,
  buyer,
  initialTerms,
  hook,
  setHook,
  words,
  setWords,
  playhead,
  onPlay,
  t,
}: {
  clip: EditorClip;
  buyer: boolean;
  initialTerms: Term[];
  hook: string;
  setHook: (v: string) => void;
  words: CaptionWord[];
  setWords: (update: (w: CaptionWord[]) => CaptionWord[]) => void;
  playhead: number | null;
  onPlay: (sourceSeconds: number) => void;
  t: Dictionary;
}) {
  const e = t.editor;
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [remember, setRemember] = useState(false);
  const [terms, setTerms] = useState(initialTerms);
  const [termError, setTermError] = useState<TermCode | null>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const matches = useMemo(() => countMatches(words, find), [words, find]);
  const original = useMemo(() => new Set(clip.words.map(wordKey)), [clip.words]);
  const lines = useMemo<Line[]>(() => {
    let at = 0;
    return captionLines(words).map((line) => {
      const from = at;
      at += line.length;
      return { words: line, from, to: at };
    });
  }, [words]);
  const captionsChanged = !sameWords(words, clip.words) || hook.trim() !== clip.hook.trim();

  async function remembered(wrong: string, correct: string) {
    const result = await saveTerm(wrong, correct);
    if (!result.ok) {
      setTermError(result.code);
      return false;
    }
    setTermError(null);
    const term = { id: result.id, wrong: wrong.trim(), correct: correct.trim() };
    setTerms((list) => [...list.filter((x) => x.id !== result.id), term]);
    return true;
  }

  function applyReplace() {
    const [wrong, correct] = [find, replace];
    setWords((w) => replaceAll(w, wrong, correct));
    setFind("");
    setReplace("");
    if (buyer && remember) void remembered(wrong, correct);
  }

  function commit(line: Line, text: string) {
    setEditing(null);
    if (text.split(/\s+/).filter(Boolean).join(" ") === lineText(line.words)) return;
    setWords((w) => [...w.slice(0, line.from), ...retimeLine(line.words, text), ...w.slice(line.to)]);
  }

  return (
    <>
      <Field label={e.hook} value={hook} onChange={setHook} maxLength={120} />

      <div className="flex flex-col gap-3">
        <h3 className="text-title-s text-on-surface">{e.replaceTitle}</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Field label={e.find} value={find} onChange={setFind} maxLength={60} className="md:flex-1" />
          <Icon name="arrowForward" size={20} className="hidden text-on-surface-variant md:block" />
          <Field label={e.replaceWith} value={replace} onChange={setReplace} maxLength={60} className="md:flex-1" />
          <button
            type="button"
            onClick={applyReplace}
            disabled={!matches || !replace.trim()}
            className="state-layer focus-ring inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full bg-secondary-container pr-6 pl-4 text-label-l text-on-secondary-container disabled:opacity-38 md:self-auto"
          >
            <Icon name="findReplace" size={20} />
            {fill(e.replaceAll, { n: matches })}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <CheckRow checked={buyer && remember} onChange={setRemember} label={e.remember} disabled={!buyer} />
          {buyer ? (
            <>
              <span aria-hidden className="text-on-surface-variant">
                ·
              </span>
              <button
                type="button"
                onClick={() => setDictionaryOpen(true)}
                className="state-layer focus-ring inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-label-l text-primary"
              >
                <Icon name="menuBook" size={18} />
                {fill(e.dictionary, { n: terms.length })}
              </button>
            </>
          ) : (
            <BuyersChip label={e.buyersOnly} />
          )}
        </div>
        {termError && !dictionaryOpen && <p className="text-body-s text-error">{e.termErrors[termError]}</p>}
      </div>

      <hr className="border-outline-variant" />

      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-title-s text-on-surface">{e.linesTitle}</h3>
          <p className="text-body-s text-on-surface-variant">
            <span className="md:hidden">{e.linesHintTouch}</span>
            <span className="hidden md:inline">{e.linesHint}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setWords(() => clip.words);
            setHook(clip.hook);
            setEditing(null);
          }}
          disabled={!captionsChanged}
          title={e.revert}
          className="state-layer focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-2.5 text-label-l text-primary disabled:text-on-surface/38 md:px-3"
        >
          <Icon name="undo" size={20} />
          <span className="sr-only md:not-sr-only">{e.revert}</span>
        </button>
      </div>

      {lines.length ? (
        <ol className="flex flex-col gap-0.5 rounded-lg bg-surface-container-lowest p-1 md:p-2">
          {lines.map((line) => {
            const start = line.words[0].start;
            const end = line.words[line.words.length - 1].end;
            const time = shortClock(Math.max(0, start - clip.start));
            const fresh = line.words.map((w) => !original.has(wordKey(w)));
            return (
              <CaptionLine
                key={`${line.from}-${start}`}
                time={time}
                words={line.words}
                fresh={fresh}
                edited={fresh.some(Boolean)}
                playing={playhead != null && playhead >= start && playhead < end}
                editing={editing === line.from}
                label={fill(e.editLine, { time })}
                onOpen={() => {
                  setEditing(line.from);
                  onPlay(start);
                }}
                onCommit={(text) => commit(line, text)}
                onCancel={() => setEditing(null)}
                editedLabel={e.edited}
              />
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg bg-surface-container-lowest p-4 text-body-m text-on-surface-variant">{e.noCaptions}</p>
      )}

      {buyer && (
        <DictionaryDialog
          open={dictionaryOpen}
          onClose={() => {
            setDictionaryOpen(false);
            setTermError(null);
          }}
          terms={terms}
          error={termError}
          onAdd={async (wrong, correct) => {
            const ok = await remembered(wrong, correct);
            // A new entry fixes this clip's captions right away too.
            if (ok) setWords((w) => replaceAll(w, wrong, correct));
            return ok;
          }}
          onRemove={(id) => {
            setTerms((list) => list.filter((x) => x.id !== id));
            void deleteTerm(id);
          }}
          t={t}
        />
      )}
    </>
  );
}

/** One sentence of captions: Default, Playing or Editing (Figma "Caption line"). */
function CaptionLine({
  time,
  words,
  fresh,
  edited,
  playing,
  editing,
  label,
  editedLabel,
  onOpen,
  onCommit,
  onCancel,
}: {
  time: string;
  words: CaptionWord[];
  /** Per word: changed since the clip was rendered. */
  fresh: boolean[];
  edited: boolean;
  playing: boolean;
  editing: boolean;
  label: string;
  editedLabel: string;
  onOpen: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!editing || !el) return;
    done.current = false;
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  const mark = edited && <Icon name="edit" size={18} title={editedLabel} className="mt-0.5 text-primary" />;

  if (editing) {
    return (
      <li className="flex items-start gap-4 rounded-md border-2 border-primary bg-surface-container-lowest px-3.5 py-2">
        <span className="w-10 shrink-0 pt-0.5 text-label-l text-on-surface-variant tabular-nums">{time}</span>
        <textarea
          ref={box}
          rows={1}
          aria-label={label}
          defaultValue={lineText(words)}
          onInput={(ev) => {
            ev.currentTarget.style.height = "auto";
            ev.currentTarget.style.height = `${ev.currentTarget.scrollHeight}px`;
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              done.current = true;
              onCommit(ev.currentTarget.value);
            } else if (ev.key === "Escape") {
              done.current = true;
              onCancel();
            }
          }}
          onBlur={(ev) => {
            if (!done.current) onCommit(ev.currentTarget.value);
          }}
          className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-body-l text-on-surface outline-none"
        />
        {mark}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className={`state-layer focus-ring flex w-full items-start gap-4 rounded-md px-4 py-2.5 text-left ${
          playing ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
        }`}
      >
        <span
          className={`w-10 shrink-0 pt-0.5 text-label-l tabular-nums ${
            playing ? "text-on-secondary-container" : "text-on-surface-variant"
          }`}
        >
          {time}
        </span>
        <span className="min-w-0 flex-1 text-body-l">
          {words.map((w, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              {fresh[i] ? <span className="font-semibold text-primary">{w.text}</span> : w.text}
            </Fragment>
          ))}
        </span>
        {mark}
      </button>
    </li>
  );
}

/** The buyer's name dictionary (Figma E6). */
function DictionaryDialog({
  open,
  onClose,
  terms,
  error,
  onAdd,
  onRemove,
  t,
}: {
  open: boolean;
  onClose: () => void;
  terms: Term[];
  error: TermCode | null;
  onAdd: (wrong: string, correct: string) => Promise<boolean>;
  onRemove: (id: number) => void;
  t: Dictionary;
}) {
  const e = t.editor;
  const dialog = useRef<HTMLDialogElement>(null);
  const [wrong, setWrong] = useState("");
  const [correct, setCorrect] = useState("");
  const [adding, startAdding] = useTransition();
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  const labelBg = "bg-surface-container-high";

  return (
    <dialog
      ref={dialog}
      aria-labelledby="dictionary-title"
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl bg-surface-container-high p-6 text-on-surface shadow-elev-3 backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Icon name="menuBook" className="text-on-surface-variant" />
          <h2 id="dictionary-title" className="min-w-0 flex-1 text-headline-s">
            {e.dictionaryTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={e.close}
            className="state-layer focus-ring -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="text-body-m text-on-surface-variant">{e.dictionaryBody}</p>
        <ul className="flex flex-col rounded-lg bg-surface-container-lowest py-1">
          {terms.length ? (
            terms.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-1 pr-1 pl-4">
                <span className="min-w-0 flex-1 truncate text-body-l text-on-surface-variant">{x.wrong}</span>
                <Icon name="arrowForward" size={18} className="text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate text-title-m text-on-surface">{x.correct}</span>
                <button
                  type="button"
                  onClick={() => onRemove(x.id)}
                  aria-label={fill(e.removeTerm, { term: x.wrong })}
                  className="state-layer focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
                >
                  <Icon name="close" />
                </button>
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-body-m text-on-surface-variant">{e.dictionaryEmpty}</li>
          )}
        </ul>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            startAdding(async () => {
              if (await onAdd(wrong, correct)) {
                setWrong("");
                setCorrect("");
              }
            });
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <Field label={e.written} value={wrong} onChange={setWrong} maxLength={60} className="sm:flex-1" labelBg={labelBg} />
          <Icon name="arrowForward" size={18} className="hidden text-on-surface-variant sm:block" />
          <Field label={e.shouldBe} value={correct} onChange={setCorrect} maxLength={60} className="sm:flex-1" labelBg={labelBg} />
          <button
            type="submit"
            disabled={adding || !wrong.trim() || !correct.trim()}
            className="state-layer focus-ring inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full bg-secondary-container pr-6 pl-4 text-label-l text-on-secondary-container disabled:opacity-38 sm:self-auto"
          >
            <Icon name="add" size={20} />
            {e.add}
          </button>
        </form>
        {error && <p className="text-body-s text-error">{e.termErrors[error]}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary"
          >
            {e.done}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function TrimTab({
  clip,
  range,
  setRange,
  coldOpen,
  setColdOpen,
  playhead,
  locale,
  t,
}: {
  clip: EditorClip;
  range: [number, number];
  setRange: (r: [number, number]) => void;
  coldOpen: boolean;
  setColdOpen: (v: boolean) => void;
  playhead: number | null;
  locale: string;
  t: Dictionary;
}) {
  const e = t.editor;
  const lo = Math.max(0, clip.aiStart - TRIM_REACH_SECONDS);
  const hi = Math.min(clip.aiEnd + TRIM_REACH_SECONDS, clip.sourceEnd ?? Infinity);
  const [start, end] = range;
  const coldOpenId = useId();

  // Pauses between sentences: where a clip can start or end without cutting one.
  const pauses = useMemo(() => {
    const lines = captionLines(clip.words);
    return {
      starts: lines.map((l, i) => {
        const prev = lines[i - 1]?.[lines[i - 1].length - 1];
        return round1(Math.max(l[0].start - 0.1, prev ? spokenEnd(prev) : 0));
      }),
      ends: lines.map((l, i) => {
        const next = lines[i + 1]?.[0];
        const last = l[l.length - 1];
        return round1(Math.min(spokenEnd(last) + 0.15, next ? next.start : Infinity));
      }),
    };
  }, [clip.words]);

  function move(which: "start" | "end", to: number, snap: boolean) {
    let v = to;
    if (snap) {
      const near = (which === "start" ? pauses.starts : pauses.ends)
        .filter((p) => Math.abs(p - to) <= SNAP_SECONDS)
        .sort((a, b) => Math.abs(a - to) - Math.abs(b - to))[0];
      v = near ?? to;
    }
    v = round1(v);
    if (which === "start") {
      v = Math.max(lo, end - MAX_CLIP_SECONDS, Math.min(v, end - MIN_CLIP_SECONDS));
      setRange([round1(v), end]);
    } else {
      v = Math.min(hi, start + MAX_CLIP_SECONDS, Math.max(v, start + MIN_CLIP_SECONDS));
      setRange([start, round1(v)]);
    }
  }

  const inClip = clip.words.filter((w) => spokenEnd(w) > start && w.start < end);
  const firstNote =
    start < clip.start - 0.3 || !inClip.length
      ? e.newPart
      : fill(e.firstLine, { text: inClip.slice(0, 6).map((w) => w.text).join(" ") });
  const lastNote =
    end > clip.end + 0.3 || !inClip.length
      ? e.newPart
      : fill(e.lastLine, { text: inClip.slice(-4).map((w) => w.text).join(" ") });

  const teaser = clip.look.teaser;
  const teaserKnown = teaser != null || (clip.legacy && clip.look.coldOpen);
  const teaserOutside =
    teaser != null && !(teaser[0] >= start + TEASER_LEAD_SECONDS && teaser[1] <= end + 0.01);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-s text-on-surface">{e.trimTitle}</h3>
        <p className="text-body-s text-on-surface-variant">{e.trimHint}</p>
      </div>
      <Timeline
        lo={lo}
        hi={hi}
        start={start}
        end={end}
        aiStart={clip.aiStart}
        aiEnd={clip.aiEnd}
        playhead={playhead}
        thumb={clip.thumb}
        onMove={move}
        t={t}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stepper
          label={e.start}
          value={tenths(start, locale)}
          note={firstNote}
          onStep={(d) => move("start", start + d * STEP_SECONDS, false)}
          t={t}
        />
        <Stepper
          label={e.end}
          value={tenths(end, locale)}
          note={lastNote}
          onStep={(d) => move("end", end + d * STEP_SECONDS, false)}
          t={t}
        />
      </div>
      <div className="flex flex-col gap-2 text-body-m text-on-surface-variant">
        <p className="flex gap-2">
          <Icon name="schedule" size={18} className="mt-px" />
          {fill(e.lengthFact, { now: shortClock(end - start), before: shortClock(clip.end - clip.start) })}
        </p>
        <p className="flex gap-2">
          <Icon name="info" size={18} className="mt-px" />
          {e.snapFact}
        </p>
      </div>
      <hr className="border-outline-variant" />
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={coldOpenId} className="block text-title-s text-on-surface">
            {e.coldOpen}
          </label>
          <p className="text-body-s text-on-surface-variant">
            {!teaserKnown ? e.coldOpenNone : coldOpen && teaserOutside ? e.coldOpenOutside : e.coldOpenHint}
          </p>
        </div>
        <Switch id={coldOpenId} checked={teaserKnown && coldOpen} onChange={setColdOpen} disabled={!teaserKnown} />
      </div>
    </>
  );
}

/** The cut on a strip of the source video, with handles for its start and end. */
function Timeline({
  lo,
  hi,
  start,
  end,
  aiStart,
  aiEnd,
  playhead,
  thumb,
  onMove,
  t,
}: {
  lo: number;
  hi: number;
  start: number;
  end: number;
  aiStart: number;
  aiEnd: number;
  playhead: number | null;
  thumb?: string;
  onMove: (which: "start" | "end", to: number, snap: boolean) => void;
  t: Dictionary;
}) {
  const e = t.editor;
  const strip = useRef<HTMLDivElement>(null);
  const span = Math.max(hi - lo, 1);
  const x = (s: number) => `${((s - lo) / span) * 100}%`;
  const ticks = [0, 1, 2, 3, 4].map((i) => lo + (span * i) / 4);
  const timeAt = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    return lo + ((clientX - r.left) / r.width) * span;
  };

  const handle = (which: "start" | "end") => {
    const value = which === "start" ? start : end;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={which === "start" ? e.start : e.end}
        aria-valuemin={Math.round(lo)}
        aria-valuemax={Math.round(hi)}
        aria-valuenow={Math.round(value)}
        aria-valuetext={shortClock(value)}
        onPointerDown={(ev) => ev.currentTarget.setPointerCapture(ev.pointerId)}
        onPointerMove={(ev) => {
          if (ev.currentTarget.hasPointerCapture(ev.pointerId)) onMove(which, timeAt(ev.clientX), true);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
            ev.preventDefault();
            onMove(which, value + (ev.key === "ArrowRight" ? STEP_SECONDS : -STEP_SECONDS), false);
          }
        }}
        className="focus-ring absolute top-0 z-10 h-16 w-3.5 cursor-ew-resize touch-none rounded-[6px] bg-primary"
        style={which === "start" ? { left: x(start) } : { left: `calc(${x(end)} - 14px)` }}
      >
        <span className="absolute top-[22px] left-1.5 h-5 w-0.5 rounded-[1px] bg-on-primary" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-label-m text-on-surface-variant tabular-nums">
        {ticks.map((s, i) => (
          <span key={i} className={i === 1 || i === 3 ? "hidden sm:inline" : undefined}>
            {shortClock(s)}
          </span>
        ))}
      </div>
      <div ref={strip} className="relative h-16 overflow-hidden rounded-md bg-[#1f3f3a]">
        <div className="absolute inset-0 flex gap-0.5" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="h-16 w-16 shrink-0 bg-cover bg-center"
              style={
                thumb
                  ? { backgroundImage: `url(${JSON.stringify(thumb)})` }
                  : { backgroundImage: "linear-gradient(to bottom, #2c5049, #5a9a87)" }
              }
            />
          ))}
        </div>
        <span className="absolute inset-y-0 left-0 bg-black/60" style={{ width: x(start) }} />
        <span className="absolute inset-y-0 right-0 bg-black/60" style={{ left: x(end) }} />
        {[aiStart, aiEnd].map((s, i) => (
          <span key={i} className="absolute inset-y-0 w-0.5 bg-white/55" style={{ left: x(s) }} />
        ))}
        <span
          className="pointer-events-none absolute inset-y-0 rounded-sm border-3 border-primary"
          style={{ left: x(start), width: `calc(${x(end)} - ${x(start)})` }}
        />
        {playhead != null && playhead >= lo && playhead <= hi && (
          <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: x(playhead) }} />
        )}
        {handle("start")}
        {handle("end")}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-body-s text-on-surface-variant tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] border-2 border-primary" />
          {fill(e.yourCut, { range: `${shortClock(start)} – ${shortClock(end)}` })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-[3px] rounded-[1px] bg-on-surface-variant" />
          {fill(e.aiCut, { range: `${shortClock(aiStart)} – ${shortClock(aiEnd)}` })}
        </span>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  note,
  onStep,
  t,
}: {
  label: string;
  value: string;
  note: string;
  onStep: (direction: 1 | -1) => void;
  t: Dictionary;
}) {
  const e = t.editor;
  const button = (direction: 1 | -1) => (
    <button
      type="button"
      onClick={() => onStep(direction)}
      aria-label={fill(direction < 0 ? e.earlier : e.later, { what: label })}
      className="state-layer focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant"
    >
      <Icon name={direction < 0 ? "remove" : "add"} />
    </button>
  );
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-4">
      <p className="text-title-s text-on-surface-variant">{label}</p>
      <div className="flex items-center gap-3">
        {button(-1)}
        <p className="min-w-0 flex-1 text-center text-headline-s text-on-surface tabular-nums">{value}</p>
        {button(1)}
      </div>
      <p className="text-body-s text-on-surface-variant">{note}</p>
    </div>
  );
}

function StyleTab({
  clip,
  look,
  setLook,
  styleToAll,
  setStyleToAll,
  t,
}: {
  clip: EditorClip;
  look: Look;
  setLook: (look: Look) => void;
  styleToAll: boolean;
  setStyleToAll: (v: boolean) => void;
  t: Dictionary;
}) {
  const e = t.editor;
  const hookTitleId = useId();
  const sample = clip.words.slice(0, 3).map((w) => bare(w.text));
  const counts = [1, 2, 3, 4, ...(look.wordsPerCaption > 4 ? [look.wordsPerCaption] : [])];
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-title-s text-on-surface">{t.create.captionTemplate}</h3>
        <TemplatePicker
          value={look.template}
          onChange={(template) => setLook({ ...look, template })}
          sample={sample.length === 3 && sample.every(Boolean) ? (sample as [string, string, string]) : undefined}
        />
      </div>
      <div className="flex flex-wrap gap-x-10 gap-y-6">
        <div className="flex max-w-full flex-col gap-2">
          <h3 className="text-title-s text-on-surface">{t.create.position}</h3>
          <Segmented
            fit
            label={t.create.position}
            value={look.position}
            onChange={(position) => setLook({ ...look, position })}
            options={CAPTION_POSITIONS.map((p) => ({ value: p, label: t.create.positions[p] }))}
          />
        </div>
        <div className="flex max-w-full flex-col gap-2">
          <h3 className="text-title-s text-on-surface">{t.create.wordsPerCaption}</h3>
          <Segmented
            fit
            label={t.create.wordsPerCaption}
            value={String(look.wordsPerCaption)}
            onChange={(n) => setLook({ ...look, wordsPerCaption: Number(n) })}
            options={counts.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-title-s text-on-surface">{t.create.layout}</h3>
        <Segmented
          fit
          label={t.create.layout}
          value={look.layout}
          onChange={(layout) => setLook({ ...look, layout })}
          options={LAYOUTS.map((v) => ({ value: v, label: t.create.layouts[v] }))}
        />
        <p className="text-body-s text-on-surface-variant">{e.layoutHint}</p>
      </div>
      <hr className="border-outline-variant" />
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={hookTitleId} className="block text-title-s text-on-surface">
            {t.create.hookTitle}
          </label>
          <p className="text-body-s text-on-surface-variant">{e.hookTitleHint}</p>
        </div>
        <Switch id={hookTitleId} checked={look.hookTitle} onChange={(hookTitle) => setLook({ ...look, hookTitle })} />
      </div>
      {clip.count > 1 && (
        <CheckRow
          checked={styleToAll}
          onChange={setStyleToAll}
          label={fill(e.styleToAll, { n: clip.count - 1 })}
        />
      )}
    </>
  );
}
