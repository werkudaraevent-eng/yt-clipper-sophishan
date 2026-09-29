"use client";

import { useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { Icon } from "./ui/Icon";

type Labels = Dictionary["youtube"];
type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done"; url: string }
  | { kind: "error"; message: string };

/** The clip card's "Post to YouTube" button and its confirm dialog (M3 basic dialog). */
export function PostToYouTube({
  clipId,
  defaultTitle,
  defaultDescription,
  postedUrl,
  labels,
}: {
  clipId: string;
  defaultTitle: string;
  defaultDescription: string;
  postedUrl?: string;
  labels: Labels;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>(postedUrl ? { kind: "done", url: postedUrl } : { kind: "idle" });
  const outlinedLabel =
    "pointer-events-none absolute -top-2 left-3 bg-surface-container-high px-1 text-body-s text-on-surface-variant";

  async function submit(form: FormData) {
    setState({ kind: "uploading" });
    try {
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clipId,
          title: form.get("title"),
          description: form.get("description"),
          privacy: form.get("privacy"),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; code?: string };
      if (res.ok && json.url) {
        setState({ kind: "done", url: json.url });
        dialog.current?.close();
        return;
      }
      const code = json.code as keyof Labels["errors"];
      setState({ kind: "error", message: labels.errors[code] ?? labels.errors.failed });
      if (code === "reconnect") window.location.reload();
    } catch {
      setState({ kind: "error", message: labels.errors.failed });
    }
  }

  if (state.kind === "done") {
    return (
      <a href={state.url} target="_blank" rel="noreferrer" className="btn-secondary w-full">
        <Icon name="checkCircle" size={18} />
        {labels.view}
      </a>
    );
  }

  const busy = state.kind === "uploading";
  return (
    <>
      <button type="button" className="btn-secondary w-full" onClick={() => dialog.current?.showModal()}>
        <Icon name="share" size={18} />
        {labels.post}
      </button>
      <dialog
        ref={dialog}
        onCancel={(e) => busy && e.preventDefault()}
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl bg-surface-container-high p-6 text-on-surface shadow-elev-3 backdrop:bg-black/40"
      >
        <form action={submit} className="flex flex-col gap-5">
          <h2 className="text-headline-s">{labels.dialogTitle}</h2>
          <div className="relative">
            <input
              id={`yt-title-${clipId}`}
              name="title"
              required
              maxLength={100}
              defaultValue={defaultTitle}
              className="input h-14"
              disabled={busy}
            />
            <label htmlFor={`yt-title-${clipId}`} className={outlinedLabel}>
              {labels.title}
            </label>
          </div>
          <div className="relative">
            <textarea
              id={`yt-desc-${clipId}`}
              name="description"
              rows={4}
              maxLength={4900}
              defaultValue={defaultDescription}
              className="input resize-y"
              disabled={busy}
            />
            <label htmlFor={`yt-desc-${clipId}`} className={outlinedLabel}>
              {labels.description}
            </label>
          </div>
          <div className="relative">
            <select
              id={`yt-privacy-${clipId}`}
              name="privacy"
              required
              defaultValue=""
              className="input h-14"
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
            <label htmlFor={`yt-privacy-${clipId}`} className={outlinedLabel}>
              {labels.privacy}
            </label>
          </div>

          {busy && (
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

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
              className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-4 text-label-l text-primary disabled:text-on-surface/38"
            >
              {labels.cancel}
            </button>
            <button className="btn-primary" disabled={busy}>
              {labels.submit}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
