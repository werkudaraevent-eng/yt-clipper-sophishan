"use client";

import {
  CLIP_LENGTHS,
  LAYOUTS,
  type CaptionPosition,
  type CaptionTemplate,
  type ClipLength,
  type JobOptionsInput,
  type Layout,
} from "@clipper/shared";
import { useActionState, useEffect, useMemo, useState } from "react";
import { ChoiceChips, RangeSlider, Segmented, SelectField, Toggle } from "@/components/controls";
import { TemplatePicker } from "@/components/TemplatePicker";
import { Icon } from "@/components/ui/Icon";
import { creditCost } from "@/lib/credits";
import { fill } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/client";
import { clock } from "@/lib/format";
import { LANGUAGES } from "@/lib/languages";
import type { VideoMeta } from "@/lib/youtube";
import { createProject } from "./actions";

const FALLBACK_DURATION = 3 * 3600;
const DEFAULT_WINDOW = 600;
// "original" lets the model pick the length, so it reads as "Auto" and comes first.
const LENGTH_ORDER: ClipLength[] = ["original", ...CLIP_LENGTHS.filter((v) => v !== "original")];

const DEFAULTS = {
  language: "auto",
  translateTo: "",
  clipLength: "30to60" as ClipLength,
  captions: true,
  template: "karaoke" as CaptionTemplate,
  position: "bottom" as CaptionPosition,
  wordsPerCaption: 3,
  hookTitle: true,
  layout: "auto" as Layout,
  direction: "",
};

export function CreateForm({
  disabled,
  credits,
  initialUrl = "",
  aside,
}: {
  disabled?: boolean;
  credits?: number | null;
  initialUrl?: string;
  /** Rendered beside the settings card on wide screens (recent projects). */
  aside?: React.ReactNode;
}) {
  const t = useDictionary();
  const [url, setUrl] = useState(initialUrl);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<keyof typeof t.errors | null>(null);
  const [language, setLanguage] = useState(DEFAULTS.language);
  const [translateTo, setTranslateTo] = useState(DEFAULTS.translateTo);
  const [range, setRange] = useState<[number, number]>([0, DEFAULT_WINDOW]);
  const [clipLength, setClipLength] = useState(DEFAULTS.clipLength);
  const [captions, setCaptions] = useState(DEFAULTS.captions);
  const [template, setTemplate] = useState(DEFAULTS.template);
  const [position, setPosition] = useState(DEFAULTS.position);
  const [wordsPerCaption, setWordsPerCaption] = useState(DEFAULTS.wordsPerCaption);
  const [hookTitle, setHookTitle] = useState(DEFAULTS.hookTitle);
  const [layout, setLayout] = useState(DEFAULTS.layout);
  const [direction, setDirection] = useState(DEFAULTS.direction);
  const [advanced, setAdvanced] = useState(false);
  const [state, formAction, pending] = useActionState(createProject, { error: null });

  // Look the video up once the URL settles.
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setMeta(null);
      setMetaError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/video-info?url=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        if (!res.ok) {
          setMeta(null);
          setMetaError(body.code === "notYoutube" ? "notYoutube" : "videoNotFound");
          return;
        }
        setMeta(body);
        setMetaError(null);
        const duration = body.duration ?? FALLBACK_DURATION;
        setRange([0, Math.min(duration, DEFAULT_WINDOW)]);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMetaError("lookupFailed");
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  const duration = meta?.duration ?? FALLBACK_DURATION;
  const cost = creditCost(range[0], range[1], meta?.duration);
  const options: JobOptionsInput = useMemo(
    () => ({
      youtubeUrl: url.trim(),
      videoLanguage: language,
      captionTranslation: translateTo || null,
      timeframe: { start: range[0], end: range[1] },
      clipLength,
      captions: { enabled: captions, template, position, wordsPerCaption },
      hookTitle,
      layout,
      aiDirection: direction,
    }),
    [url, language, translateTo, range, clipLength, captions, template, position,
     wordsPerCaption, hookTitle, layout, direction], // prettier-ignore
  );

  function reset() {
    setLanguage(DEFAULTS.language);
    setTranslateTo(DEFAULTS.translateTo);
    setRange([0, Math.min(duration, DEFAULT_WINDOW)]);
    setClipLength(DEFAULTS.clipLength);
    setCaptions(DEFAULTS.captions);
    setTemplate(DEFAULTS.template);
    setPosition(DEFAULTS.position);
    setWordsPerCaption(DEFAULTS.wordsPerCaption);
    setHookTitle(DEFAULTS.hookTitle);
    setLayout(DEFAULTS.layout);
    setDirection(DEFAULTS.direction);
  }

  const error = metaError
    ? t.errors[metaError]
    : state.code
      ? t.errors[state.code]
      : state.error;
  const wholeVideo = meta?.duration != null && range[0] === 0 && range[1] >= meta.duration;

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="options" value={JSON.stringify(options)} />

      <section
        id="create"
        className="flex scroll-mt-20 flex-col items-center gap-5 rounded-xl bg-surface-container-low px-4 py-10 text-center sm:px-10"
      >
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-sm bg-tertiary px-2 py-1 text-label-m text-on-tertiary">
          <Icon name="wand" size={16} />
          {t.home.badge}
        </span>
        <div className="flex max-w-4xl flex-col gap-3">
          <h2 className="text-headline-m text-on-surface sm:text-display-s">
            {t.home.heroTitle}
          </h2>
          <p className="mx-auto max-w-2xl text-body-l text-on-surface-variant">{t.home.heroSubtitle}</p>
        </div>

        <div className="w-full max-w-[720px]">
          <div className="flex flex-col gap-3 sm:relative">
            <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-5 text-left focus-within:ring-2 focus-within:ring-primary sm:h-16 sm:pr-40">
              <Icon name="link" className="shrink-0 text-on-surface-variant" />
              <span className="sr-only">{t.create.url}</span>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.create.urlPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface outline-none placeholder:text-on-surface-variant"
              />
            </label>
            <button
              className="btn-primary h-12 sm:absolute sm:top-2 sm:right-2"
              disabled={disabled || pending || !meta || (credits != null && cost > credits)}
            >
              <Icon name="wand" size={20} />
              {pending ? t.create.starting : t.create.submit}
            </button>
          </div>

          {meta && (
            <p className="mt-3 flex items-center justify-center gap-2 text-body-m text-on-surface">
              <Icon name="checkCircle" size={18} className="shrink-0 text-primary" />
              <span className="truncate">{meta.title}</span>
              {meta.duration != null && (
                <span className="shrink-0 text-on-surface-variant">· {clock(meta.duration)}</span>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 flex items-center justify-center gap-2 text-body-m text-error">
              <Icon name="error" size={18} className="shrink-0" />
              {error}
            </p>
          )}
          <p className="mt-3 flex items-center justify-center gap-2 text-body-s text-on-surface-variant">
            <Icon name="tollFill" size={16} className="shrink-0 text-primary" />
            {credits != null
              ? fill(t.create.cost, { cost, balance: credits })
              : fill(t.create.costUnknown, { cost })}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
        <section className="flex flex-col gap-7 rounded-lg border border-outline-variant bg-surface-container-lowest p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-title-l text-on-surface">{t.create.settings}</h2>
            <button
              type="button"
              onClick={reset}
              className="state-layer focus-ring inline-flex h-10 items-center gap-2 rounded-full px-3 text-label-l text-primary"
            >
              <Icon name="refresh" size={18} />
              {t.create.reset}
            </button>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label={t.create.videoLanguage}
              value={language}
              onChange={setLanguage}
              supporting={t.create.checkLanguage}
            >
              <option value="auto">{t.create.autoDetect}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t.create.translateTo}
              value={translateTo}
              onChange={setTranslateTo}
              disabled={!captions}
            >
              <option value="">{t.create.noTranslation}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.name}
                </option>
              ))}
            </SelectField>
          </div>

          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-title-s text-on-surface">{t.create.clipLength}</h3>
              <p className="text-body-s text-on-surface-variant">{t.create.clipLengthHint}</p>
            </div>
            <Segmented
              label={t.create.clipLength}
              value={clipLength}
              onChange={setClipLength}
              options={LENGTH_ORDER.map((v) => ({ value: v, label: t.create.clipLengths[v] }))}
            />
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-title-s text-on-surface">{t.create.timeframe}</h3>
              <p className="text-body-s text-on-surface-variant">
                {clock(range[0])} – {clock(range[1])}
                {wholeVideo && ` · ${t.create.wholeVideo}`}
              </p>
            </div>
            {meta && (
              <div className="overflow-hidden rounded-md bg-surface-container-highest">
                <iframe
                  className="aspect-video w-full"
                  src={`https://www.youtube-nocookie.com/embed/${meta.id}`}
                  title={meta.title}
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
            <RangeSlider
              min={0}
              max={duration}
              start={range[0]}
              end={range[1]}
              step={5}
              onChange={(s, e) => setRange([s, e])}
              format={clock}
            />
          </section>

          <section className="flex flex-col gap-4">
            <Toggle
              label={t.create.captions}
              hint={t.create.captionsHint}
              checked={captions}
              onChange={setCaptions}
            />
            {captions && (
              <>
                <TemplatePicker value={template} onChange={setTemplate} />
                <ChoiceChips
                  label={t.create.position}
                  value={position}
                  onChange={setPosition}
                  options={(["top", "middle", "bottom"] as const).map((p) => ({
                    value: p,
                    label: t.create.positions[p],
                  }))}
                />
              </>
            )}
          </section>

          <section className="overflow-hidden rounded-md bg-surface-container">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
              className="state-layer focus-ring flex w-full items-center gap-4 px-4 py-3 text-left"
            >
              <Icon name="settingsFill" className="shrink-0 text-on-surface-variant" />
              <span className="flex-1">
                <span className="block text-title-s text-on-surface">{t.create.advanced}</span>
                <span className="block text-body-s text-on-surface-variant">{t.create.advancedHint}</span>
              </span>
              <Icon
                name="chevronDown"
                className={`shrink-0 text-on-surface-variant transition-transform ${advanced ? "rotate-180" : ""}`}
              />
            </button>
            {advanced && (
              <div className="flex flex-col gap-6 border-t border-outline-variant bg-surface-container-lowest p-4">
                <Toggle
                  label={t.create.hookTitle}
                  hint={t.create.hookHint}
                  checked={hookTitle}
                  onChange={setHookTitle}
                />
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="wpc" className="text-title-s text-on-surface">
                    {t.create.wordsPerCaption}
                  </label>
                  <input
                    id="wpc"
                    type="number"
                    min={1}
                    max={6}
                    value={wordsPerCaption}
                    disabled={!captions}
                    onChange={(e) =>
                      setWordsPerCaption(Math.min(6, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="input w-20 text-center"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="text-title-s text-on-surface">{t.create.layout}</h3>
                  <Segmented
                    label={t.create.layout}
                    value={layout}
                    onChange={setLayout}
                    options={LAYOUTS.map((v) => ({ value: v, label: t.create.layouts[v] }))}
                  />
                  <p className="text-body-s text-on-surface-variant">{t.create.layoutHint}</p>
                </div>
                <div className="relative">
                  <textarea
                    id="direction"
                    rows={3}
                    maxLength={1000}
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder={t.create.directionPlaceholder}
                    className="input"
                  />
                  <label
                    htmlFor="direction"
                    className="pointer-events-none absolute -top-2 left-3 bg-surface-container-lowest px-1 text-body-s text-on-surface-variant"
                  >
                    {t.create.direction}
                  </label>
                </div>
              </div>
            )}
          </section>
        </section>

        {aside && <div className="flex min-w-0 flex-col gap-4">{aside}</div>}
      </div>
    </form>
  );
}
