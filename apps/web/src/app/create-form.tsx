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
import { RangeSlider, Segmented, Toggle } from "@/components/controls";
import { TemplatePicker } from "@/components/TemplatePicker";
import { creditCost } from "@/lib/credits";
import { fill } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/client";
import { clock } from "@/lib/format";
import { LANGUAGES } from "@/lib/languages";
import type { VideoMeta } from "@/lib/youtube";
import { createProject } from "./actions";

const FALLBACK_DURATION = 3 * 3600;
const DEFAULT_WINDOW = 600;

export function CreateForm({ disabled, credits }: { disabled?: boolean; credits?: number | null }) {
  const t = useDictionary();
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<keyof typeof t.errors | null>(null);
  const [language, setLanguage] = useState("auto");
  const [translate, setTranslate] = useState(false);
  const [translateTo, setTranslateTo] = useState("en");
  const [range, setRange] = useState<[number, number]>([0, DEFAULT_WINDOW]);
  const [clipLength, setClipLength] = useState<ClipLength>("30to60");
  const [captions, setCaptions] = useState(true);
  const [template, setTemplate] = useState<CaptionTemplate>("karaoke");
  const [position, setPosition] = useState<CaptionPosition>("bottom");
  const [wordsPerCaption, setWordsPerCaption] = useState(3);
  const [hookTitle, setHookTitle] = useState(true);
  const [layout, setLayout] = useState<Layout>("auto");
  const [direction, setDirection] = useState("");
  const [advanced, setAdvanced] = useState(true);
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
      captionTranslation: translate ? translateTo : null,
      timeframe: { start: range[0], end: range[1] },
      clipLength,
      captions: { enabled: captions, template, position, wordsPerCaption },
      hookTitle,
      layout,
      aiDirection: direction,
    }),
    [url, language, translate, translateTo, range, clipLength, captions, template, position,
     wordsPerCaption, hookTitle, layout, direction], // prettier-ignore
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="options" value={JSON.stringify(options)} />

      <div>
        <label htmlFor="url" className="mb-1 block text-sm text-muted">
          {t.create.url}
        </label>
        <div className="flex">
          <input
            id="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="input rounded-r-none"
          />
          <button
            className="btn-primary shrink-0 rounded-l-none px-5"
            disabled={disabled || pending || !meta || (credits != null && cost > credits)}
          >
            {pending ? t.create.starting : t.create.submit}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {credits != null
            ? fill(t.create.cost, { cost, balance: credits })
            : fill(t.create.costUnknown, { cost })}
        </p>
        {metaError && <p className="mt-1 text-sm text-red-600">{t.errors[metaError]}</p>}
        {(state.code || state.error) && (
          <p className="mt-1 text-sm text-red-600">
            {state.code ? t.errors[state.code] : state.error}
          </p>
        )}
      </div>

      <p className="text-xs text-green-700 dark:text-green-400">
        {t.create.checkLanguage}
      </p>

      <div className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
        <label htmlFor="lang" className="text-sm text-muted">
          {t.create.videoLanguage}
        </label>
        <select
          id="lang"
          className="input"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="auto">🌐 {t.create.autoDetect}</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.flag} {l.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={translate}
            onChange={(e) => setTranslate(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          {t.create.translation}
        </label>
        <select
          aria-label={t.create.translateTo}
          className="input"
          value={translateTo}
          disabled={!translate}
          onChange={(e) => setTranslateTo(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.flag} {l.name}
            </option>
          ))}
        </select>
      </div>

      {meta && (
        <div className="overflow-hidden rounded-lg">
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${meta.id}`}
            title={meta.title}
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm text-muted">{t.create.timeframe}</h2>
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

      <section>
        <h2 className="mb-2 text-sm text-muted">{t.create.clipLength}</h2>
        <Segmented
          label={t.create.clipLength}
          value={clipLength}
          onChange={setClipLength}
          options={CLIP_LENGTHS.map((v) => ({ value: v, label: t.create.clipLengths[v] }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Toggle label={t.create.captions} checked={captions} onChange={setCaptions} />
        {captions && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-muted">{t.create.template}</h2>
              <select
                aria-label={t.create.position}
                className="rounded-md border border-accent px-2 py-1 text-xs text-accent"
                value={position}
                onChange={(e) => setPosition(e.target.value as CaptionPosition)}
              >
                {(["bottom", "middle", "top"] as const).map((p) => (
                  <option key={p} value={p}>
                    {t.create.position} · {t.create.positions[p]}
                  </option>
                ))}
              </select>
            </div>
            <TemplatePicker value={template} onChange={setTemplate} />
          </>
        )}
      </section>

      <section className="card flex flex-col gap-4">
        <button
          type="button"
          className="flex items-center justify-between text-sm font-medium"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {t.create.advanced} <span aria-hidden>{advanced ? "▲" : "▼"}</span>
        </button>
        {advanced && (
          <div className="flex flex-col gap-5 border-t border-border pt-4">
            <Toggle
              label={t.create.hookTitle}
              hint={t.create.hookHint}
              checked={hookTitle}
              onChange={setHookTitle}
            />
            <div className="flex items-center justify-between">
              <label htmlFor="wpc" className="text-sm text-muted">
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
                className="input w-16 text-center"
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm text-muted">{t.create.layout}</h3>
              <Segmented
                label={t.create.layout}
                value={layout}
                onChange={setLayout}
                options={LAYOUTS.map((v) => ({ value: v, label: t.create.layouts[v] }))}
              />
              <p className="mt-2 text-xs text-muted">{t.create.layoutHint}</p>
            </div>
            <div>
              <label htmlFor="direction" className="mb-1 block text-sm text-muted">
                {t.create.direction}
              </label>
              <textarea
                id="direction"
                rows={3}
                maxLength={1000}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder={t.create.directionPlaceholder}
                className="input"
              />
            </div>
          </div>
        )}
      </section>
    </form>
  );
}
