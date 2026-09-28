"use client";

import { PIPELINE_STAGES } from "@clipper/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/ui/Icon";
import { fill } from "@/lib/i18n/dictionaries";
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
  const stage = current as keyof typeof t.progress.stages | null;

  return (
    <section className="flex flex-col gap-5 rounded-xl bg-surface-container-low p-5 sm:p-6" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={running ? "processing" : "queued"} />
        {currentIndex >= 0 && (
          <span className="text-label-l text-on-surface-variant">
            {fill(t.progress.step, { n: currentIndex + 1, total: PIPELINE_STAGES.length })}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-headline-s text-on-surface sm:text-headline-m">
            {stage ? (t.progress.stages[stage] ?? stage) : t.progress.waiting}
          </h2>
          {stage && t.progress.stageHints[stage] && (
            <p className="mt-1 text-body-m text-on-surface-variant">{t.progress.stageHints[stage]}</p>
          )}
        </div>
        {running && (
          <span className="shrink-0 text-display-s text-primary tabular-nums">{percent}%</span>
        )}
      </div>

      {/* M3 linear progress: active track, gap, remaining track with a stop mark. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={running ? percent : undefined}
        className="flex h-1 items-center gap-1"
      >
        {running ? (
          <>
            <div
              className={`h-full rounded-full transition-all ${stale ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
            <div className="relative h-full flex-1 rounded-full bg-secondary-container">
              <span className="absolute top-0 right-0 h-1 w-1 rounded-full bg-primary" />
            </div>
          </>
        ) : (
          <div className="relative h-full w-full overflow-hidden rounded-full bg-secondary-container">
            <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.6s_ease-in-out_infinite] rounded-full bg-primary" />
          </div>
        )}
      </div>

      {job && running && job.locked_at && (
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-body-s text-on-surface-variant tabular-nums">
          <span className="flex items-center gap-1">
            <Icon name="schedule" size={16} />
            {fill(t.progress.elapsed, { time: duration(now - Date.parse(job.created_at)) })}
          </span>
          <span className="flex items-center gap-1">
            <Icon name="refresh" size={16} />
            {fill(t.progress.lastUpdate, { time: duration(sinceUpdate) })}
          </span>
        </p>
      )}
      {!running && job && (
        <p className="flex items-center gap-1 text-body-s text-on-surface-variant tabular-nums">
          <Icon name="hourglass" size={16} />
          {fill(t.progress.queuedFor, { time: duration(now - Date.parse(job.created_at)) })}
        </p>
      )}

      {stale && (
        <p role="alert" className="flex gap-2 rounded-md bg-warning-container p-3 text-body-m text-on-warning-container">
          <Icon name="error" size={20} className="shrink-0" />
          {fill(t.progress.stale, { time: duration(sinceUpdate) })}
        </p>
      )}
      {job?.status === "queued" && job.attempt > 0 && (
        <p className="flex gap-2 rounded-md bg-warning-container p-3 text-body-m text-on-warning-container">
          <Icon name="refresh" size={20} className="shrink-0" />
          {t.progress.retrying} ({job.attempt}/{job.max_attempts}) {t.progress.after} {job.error}
        </p>
      )}

      <ol className="flex flex-col overflow-hidden rounded-md bg-surface-container-lowest py-2">
        {PIPELINE_STAGES.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li
              key={s}
              aria-current={active ? "step" : undefined}
              className={`flex h-12 items-center gap-4 px-4 text-body-l ${
                active ? "bg-secondary-container text-on-secondary-container" : done ? "text-on-surface" : "text-on-surface-variant"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {done ? (
                  <Icon name="checkCircle" className="text-primary" />
                ) : active ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-outline" />
                )}
              </span>
              <span className="flex-1">{t.progress.stages[s]}</span>
              {active && <span className="text-label-l tabular-nums">{percent}%</span>}
            </li>
          );
        })}
      </ol>

      <p className="flex gap-2 text-body-s text-on-surface-variant">
        <Icon name="info" size={18} className="shrink-0" />
        {t.progress.closeNote}
      </p>
    </section>
  );
}
