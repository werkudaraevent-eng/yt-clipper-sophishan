"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fill } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/client";
import { createClient } from "@/lib/supabase/client";

/** A saved clip edit waiting for, or in, its re-render. */
export type Rerender = { clipId: string; progress: number };

const POLL_MS = 3000;
const Active = createContext<Map<string, number>>(new Map());

function byClip(list: Rerender[]) {
  return new Map(list.map((r) => [r.clipId, r.progress]));
}

/**
 * Follows the project's clip re-renders while any are queued or running, and
 * reloads the page when one finishes so its card shows the new file.
 */
export function RerenderWatch({
  projectId,
  initial,
  children,
}: {
  projectId: string;
  initial: Rerender[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState(() => byClip(initial));
  const known = useRef(new Set(initial.map((r) => r.clipId)));
  const watching = active.size > 0;

  useEffect(() => {
    if (!watching) return;
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("jobs")
        .select("clip_id, progress")
        .eq("project_id", projectId)
        .eq("kind", "rerender_clip")
        .in("status", ["queued", "running"]);
      if (!data) return;
      const next = byClip(data.filter((j) => j.clip_id).map((j) => ({ clipId: j.clip_id!, progress: j.progress })));
      const finished = [...known.current].some((id) => !next.has(id));
      known.current = new Set(next.keys());
      setActive(next);
      if (finished) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, projectId, router]);

  return <Active.Provider value={active}>{children}</Active.Provider>;
}

/** Covers a clip's video while its edit renders (Figma E5). */
export function RerenderOverlay({ clipId }: { clipId: string }) {
  const t = useDictionary();
  const progress = useContext(Active).get(clipId);
  if (progress === undefined) return null;
  const percent = Math.round(progress * 100);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/62 px-6 text-center text-white">
      <Icon name="hourglass" size={32} />
      <p className="text-label-l">{fill(t.editor.rendering, { n: percent })}</p>
      <span className="h-1 w-40 max-w-full overflow-hidden rounded-[2px] bg-white/30">
        <span className="block h-1 rounded-[2px] bg-white" style={{ width: `${percent}%` }} />
      </span>
      <p className="text-body-s text-white/85">{t.editor.renderingHint}</p>
    </div>
  );
}

/** The card's edit button; it waits while the clip's last edit renders. */
export function EditClipButton({ clipId, href }: { clipId: string; href: string }) {
  const t = useDictionary();
  const busy = useContext(Active).has(clipId);
  const look =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container";
  if (busy) {
    return (
      <button type="button" disabled title={t.editor.errors.inProgress} aria-label={t.editor.edit} className={`${look} opacity-38`}>
        <Icon name="edit" />
      </button>
    );
  }
  return (
    <Link href={href} title={t.editor.edit} aria-label={t.editor.edit} className={`state-layer focus-ring ${look}`}>
      <Icon name="edit" />
    </Link>
  );
}
