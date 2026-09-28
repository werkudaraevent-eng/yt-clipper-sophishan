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
import { clock } from "@/lib/format";
import { LANGUAGES } from "@/lib/languages";
import type { VideoMeta } from "@/lib/youtube";
import { createProject } from "./actions";

const CLIP_LENGTH_LABELS: Record<ClipLength, string> = {
  lt30: "<30s",
  "30to60": "30s~60s",
  "60to90": "60s~90s",
  original: "Original",
};
const LAYOUT_LABELS: Record<Layout, string> = {
  auto: "Auto",
  fill: "Fill",
  fit: "Fit",
  square: "Square",
};
const FALLBACK_DURATION = 3 * 3600;
const DEFAULT_WINDOW = 600;

export function CreateForm({ disabled }: { disabled?: boolean }) {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
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
          setMetaError(body.error ?? "Video not found");
          return;
        }
        setMeta(body);
        setMetaError(null);
        const duration = body.duration ?? FALLBACK_DURATION;
        setRange([0, Math.min(duration, DEFAULT_WINDOW)]);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMetaError("Could not look up the video");
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  const duration = meta?.duration ?? FALLBACK_DURATION;
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
          YouTube URL
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
            disabled={disabled || pending || !meta}
          >
            {pending ? "Starting…" : "Get Shorts"}
          </button>
        </div>
        {metaError && <p className="mt-1 text-sm text-red-600">{metaError}</p>}
        {state.error && <p className="mt-1 text-sm text-red-600">{state.error}</p>}
      </div>

      <p className="text-xs text-green-700 dark:text-green-400">
        *Please check if the language of the video is correct
      </p>

      <div className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
        <label htmlFor="lang" className="text-sm text-muted">
          Video Language
        </label>
        <select
          id="lang"
          className="input"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="auto">🌐 Auto detect</option>
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
          Caption Translation
        </label>
        <select
          aria-label="Translate captions to"
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
        <h2 className="mb-2 text-sm text-muted">Processing Timeframe</h2>
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
        <h2 className="mb-2 text-sm text-muted">Preferred Clip length</h2>
        <Segmented
          label="Preferred clip length"
          value={clipLength}
          onChange={setClipLength}
          options={CLIP_LENGTHS.map((v) => ({ value: v, label: CLIP_LENGTH_LABELS[v] }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Toggle label="Captions" checked={captions} onChange={setCaptions} />
        {captions && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-muted">Template</h2>
              <select
                aria-label="Caption position"
                className="rounded-md border border-accent px-2 py-1 text-xs text-accent"
                value={position}
                onChange={(e) => setPosition(e.target.value as CaptionPosition)}
              >
                <option value="bottom">Caption position · Bottom</option>
                <option value="middle">Caption position · Middle</option>
                <option value="top">Caption position · Top</option>
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
          Advanced Options <span aria-hidden>{advanced ? "▲" : "▼"}</span>
        </button>
        {advanced && (
          <div className="flex flex-col gap-5 border-t border-border pt-4">
            <Toggle
              label="Hook Title"
              hint="A punchy line on screen for the first 3 seconds"
              checked={hookTitle}
              onChange={setHookTitle}
            />
            <div className="flex items-center justify-between">
              <label htmlFor="wpc" className="text-sm text-muted">
                Words Per Caption
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
              <h3 className="mb-2 text-sm text-muted">Layout</h3>
              <Segmented
                label="Layout"
                value={layout}
                onChange={setLayout}
                options={LAYOUTS.map((v) => ({ value: v, label: LAYOUT_LABELS[v] }))}
              />
              <p className="mt-2 text-xs text-muted">
                Auto follows the speaker&apos;s face. Fit keeps the whole frame on a blurred
                background.
              </p>
            </div>
            <div>
              <label htmlFor="direction" className="mb-1 block text-sm text-muted">
                AI direction (optional)
              </label>
              <textarea
                id="direction"
                rows={3}
                maxLength={1000}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder='e.g. "Focus on the money advice" or "Clip 2:00 - 2:50 exactly"'
                className="input"
              />
            </div>
          </div>
        )}
      </section>
    </form>
  );
}
