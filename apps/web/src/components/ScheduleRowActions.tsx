"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fill } from "@/lib/i18n/dictionaries";
import { cancelScheduledPost } from "@/lib/schedule-actions";
import { PostDialog, type Scheduling } from "./PostToYouTube";
import { Icon } from "./ui/Icon";

type Labels = { schedule: Dictionary["schedule"]; youtube: Dictionary["youtube"] };
type Privacy = "public" | "unlisted" | "private";

export type RowPost = {
  id: string;
  clipId: string;
  status: "scheduled" | "uploading" | "failed" | "published";
  at: string | null;
  title: string;
  description: string;
  privacy: Privacy;
  externalId: string | null;
  needsReconnect: boolean;
};

/**
 * The trailing actions of a row on the Schedule page: the retry or reconnect
 * button of a failed post, and the overflow menu (change, post now, cancel;
 * open on YouTube once live). `variant="inline"` is the button alone, placed
 * under the text on compact windows.
 */
export function ScheduleRowActions({
  post,
  scheduling,
  labels,
  locale,
  variant = "trailing",
}: {
  post: RowPost;
  scheduling: Scheduling;
  labels: Labels;
  locale: string;
  variant?: "trailing" | "inline";
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const menu = useRef<HTMLDivElement>(null);
  const { schedule, youtube } = labels;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  async function postNow() {
    setMenuOpen(false);
    setUploading(true);
    try {
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clipId: post.clipId,
          title: post.title,
          description: post.description,
          privacy: post.privacy,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: keyof Dictionary["youtube"]["errors"] };
      if (!res.ok) setError(youtube.errors[json.code ?? "failed"] ?? youtube.errors.failed);
    } catch {
      setError(youtube.errors.failed);
    } finally {
      setUploading(false);
      router.refresh();
    }
  }

  function cancel() {
    setMenuOpen(false);
    startTransition(() => cancelScheduledPost(post.id));
  }

  const failed = post.status === "failed";
  const primary =
    failed &&
    (post.needsReconnect ? (
      <a
        href={`/api/youtube/connect?next=${encodeURIComponent("/schedule")}`}
        className="state-layer focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-secondary-container pr-6 pl-4 text-label-l text-on-secondary-container"
      >
        <Icon name="refresh" size={20} />
        {schedule.reconnect}
      </a>
    ) : (
      <button
        type="button"
        onClick={postNow}
        disabled={uploading}
        className="state-layer focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-secondary-container pr-6 pl-4 text-label-l text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface/38"
      >
        <Icon name="refresh" size={20} />
        {schedule.retry}
      </button>
    ));

  const snackbar = error && (
    <p
      role="alert"
      className="fixed bottom-24 left-1/2 z-30 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-xs bg-inverse-surface px-4 py-3.5 text-body-m text-inverse-on-surface shadow-elev-3 md:bottom-6"
    >
      {error}
    </p>
  );

  if (variant === "inline") {
    return (
      <>
        {primary && <div className="mt-2">{primary}</div>}
        {snackbar}
      </>
    );
  }

  const items: { label: string; onSelect: () => void; href?: string }[] = [];
  if (post.status === "scheduled") {
    items.push({ label: schedule.actions.edit, onSelect: () => setDialogOpen(true) });
    items.push({ label: schedule.actions.postNow, onSelect: postNow });
    items.push({ label: schedule.actions.cancel, onSelect: cancel });
  } else if (failed) {
    items.push({ label: schedule.actions.reschedule, onSelect: () => setDialogOpen(true) });
    items.push({ label: schedule.actions.remove, onSelect: cancel });
  } else if (post.status === "published" && post.externalId) {
    items.push({
      label: schedule.actions.open,
      href: `https://youtube.com/shorts/${post.externalId}`,
      onSelect: () => setMenuOpen(false),
    });
  }

  return (
    <>
      {primary && <span className="hidden sm:contents">{primary}</span>}
      {uploading || post.status === "uploading" ? (
        <span role="status" className="flex h-10 w-10 shrink-0 items-center justify-center" title={youtube.uploading}>
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="sr-only">{youtube.uploading}</span>
        </span>
      ) : items.length > 0 ? (
        <div ref={menu} className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={fill(schedule.more, { title: post.title })}
            onClick={() => setMenuOpen((o) => !o)}
            className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full text-on-surface"
          >
            <Icon name="moreVert" />
          </button>
          {menuOpen && (
            <ul
              role="menu"
              className="absolute top-full right-0 z-20 min-w-48 rounded-xs bg-surface-container py-2 shadow-elev-2"
            >
              {items.map((item) => (
                <li key={item.label} role="none">
                  {item.href ? (
                    <a
                      role="menuitem"
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={item.onSelect}
                      className="state-layer flex h-12 items-center px-3 text-body-l whitespace-nowrap text-on-surface"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={item.onSelect}
                      className="state-layer flex h-12 w-full items-center px-3 text-left text-body-l whitespace-nowrap text-on-surface"
                    >
                      {item.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <span className="w-10 shrink-0" />
      )}
      {(post.status === "scheduled" || failed) && (
        <PostDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          clipId={post.clipId}
          initial={{
            title: post.title,
            description: post.description,
            privacy: post.privacy,
            at: failed ? undefined : (post.at ?? undefined),
            later: true,
          }}
          scheduling={scheduling}
          labels={youtube}
          locale={locale}
        />
      )}
      {snackbar}
    </>
  );
}
