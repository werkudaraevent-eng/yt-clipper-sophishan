"use client";

import { PIPELINE_STAGES } from "@clipper/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/client";
import { createClient } from "@/lib/supabase/client";

type JobState = {
  stage: string | null;
  progress: number;
  status: string;
  attempt: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  // Set when a worker claims the job and refreshed on every progress report.
  locked_at: string | null;
};

const POLL_MS = 3000;
// Workers report at least every few seconds while downloading or transcribing;
// the LLM call and each clip render can run a minute or two without a report.
const STALE_MS = 3 * 60 * 1000;

function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function Progress({
  projectId,
  projectStatus,
  initial,
}: {
  projectId: string;
  projectStatus: string;
  initial: JobState | null;
}) {
  const router = useRouter();
  const t = useDictionary();
  const [job, setJob] = useState<JobState | null>(initial);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      setNow(Date.now());
      const [{ data: project }, { data: latest }] = await Promise.all([
        supabase.from("projects").select("status").eq("id", projectId).single(),
        supabase
          .from("jobs")
          .select("stage, progress, status, attempt, max_attempts, error, created_at, locked_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (latest) setJob(latest);
      // Re-render the page (badge, clips, error) whenever the project moves on.
      if (project && project.status !== projectStatus) {
        clearInterval(timer);
        router.refresh();
      }
    }, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [projectId, projectStatus, router]);

  const running = job?.status === "running";
  const current = running ? job.stage : null;
  const currentIndex = current ? PIPELINE_STAGES.indexOf(current as never) : -1;
  const percent = Math.round((job?.progress ?? 0) * 100);
  const sinceUpdate = job?.locked_at ? now - Date.parse(job.locked_at) : 0;
  const stale = running && sinceUpdate > STALE_MS;

  return (
    <section className="card flex flex-col gap-3" aria-live="polite">
      {running && current && (
        <p className="flex items-baseline justify-between gap-3 font-semibold">
          <span>{t.progress.stages[current as keyof typeof t.progress.stages] ?? current}</span>
          <span className="tabular-nums">{percent}%</span>
        </p>
      )}
      <div className="h-2 overflow-hidden rounded bg-border">
        <div
          className={`h-full transition-all ${stale ? "bg-amber-500" : "bg-accent"} ${running ? "animate-pulse" : ""}`}
          style={{ width: `${Math.max(percent, running ? 2 : 0)}%` }}
        />
      </div>
      <ol className="flex flex-col gap-1 text-sm">
        {PIPELINE_STAGES.map((stage, i) => (
          <li
            key={stage}
            className={i < currentIndex ? "text-muted line-through" : i === currentIndex ? "font-semibold" : "text-muted"}
          >
            {i < currentIndex ? "✓" : i === currentIndex ? "…" : "○"} {t.progress.stages[stage]}
          </li>
        ))}
      </ol>
      {job && running && job.locked_at && (
        <p className="text-xs text-muted tabular-nums">
          {t.progress.elapsed.replace("{time}", duration(now - Date.parse(job.created_at)))} ·{" "}
          {t.progress.lastUpdate.replace("{time}", duration(sinceUpdate))}
        </p>
      )}
      {stale && <p className="text-xs text-amber-700">{t.progress.stale.replace("{time}", duration(sinceUpdate))}</p>}
      {job?.status === "queued" && job.attempt > 0 && (
        <p className="text-xs text-amber-700">
          {t.progress.retrying} ({job.attempt}/{job.max_attempts}) {t.progress.after} {job.error}
        </p>
      )}
      {!running && (
        <p className="text-xs text-muted tabular-nums">
          {t.progress.waiting}
          {job && ` ${t.progress.queuedFor.replace("{time}", duration(now - Date.parse(job.created_at)))}`}
        </p>
      )}
    </section>
  );
}
