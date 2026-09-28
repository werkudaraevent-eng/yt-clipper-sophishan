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
};

const POLL_MS = 3000;

export function Progress({ projectId, initial }: { projectId: string; initial: JobState | null }) {
  const router = useRouter();
  const t = useDictionary();
  const [job, setJob] = useState<JobState | null>(initial);

  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      const [{ data: project }, { data: latest }] = await Promise.all([
        supabase.from("projects").select("status").eq("id", projectId).single(),
        supabase
          .from("jobs")
          .select("stage, progress, status, attempt, max_attempts, error")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (latest) setJob(latest);
      if (project && (project.status === "ready" || project.status === "failed")) {
        clearInterval(timer);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, router]);

  const current = job?.stage ?? null;
  const currentIndex = current ? PIPELINE_STAGES.indexOf(current as never) : -1;
  return (
    <section className="card flex flex-col gap-3" aria-live="polite">
      <div className="h-2 overflow-hidden rounded bg-border">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }}
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
      {job?.status === "queued" && job.attempt > 0 && (
        <p className="text-xs text-amber-700">
          {t.progress.retrying} ({job.attempt}/{job.max_attempts}) {t.progress.after} {job.error}
        </p>
      )}
      {!current && <p className="text-xs text-muted">{t.progress.waiting}</p>}
    </section>
  );
}
