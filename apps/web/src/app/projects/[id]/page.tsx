import { notFound } from "next/navigation";
import type { ProjectStatus } from "@clipper/shared";
import { Header } from "@/components/Header";
import { StatusBadge } from "@/components/StatusBadge";
import { clock } from "@/lib/format";
import { getDictionary } from "@/lib/i18n/server";
import { currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Progress } from "./progress";

import { CLIPS_BUCKET } from "@/lib/storage";
const SIGNED_URL_SECONDS = 60 * 60;

type Clip = {
  id: string;
  position: number;
  start_seconds: number;
  end_seconds: number;
  title: string | null;
  hook_text: string | null;
  description: string | null;
  virality_score: number | null;
  video_path: string | null;
  thumbnail_path: string | null;
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const t = await getDictionary();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, youtube_url, status, error, options, created_at, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: job }, { data: clips }] = await Promise.all([
    supabase
      .from("jobs")
      .select("stage, progress, status, attempt, max_attempts, error, created_at, locked_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("clips").select("*").eq("project_id", id).order("position").returns<Clip[]>(),
  ]);

  // Storage paths look like "<user>/<project>/clip-01.mp4"; local worker paths
  // (dev without storage) start with "/" and cannot be served.
  const paths = (clips ?? [])
    .flatMap((c) => [c.video_path, c.thumbnail_path])
    .filter((p): p is string => Boolean(p) && !p!.startsWith("/"));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage
      .from(CLIPS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    data?.forEach((d) => d.signedUrl && d.path && signed.set(d.path, d.signedUrl));
  }

  const status = project.status as ProjectStatus;
  return (
    <>
      <Header user={user} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{project.title ?? t.projects.untitled}</h1>
            <a href={project.youtube_url} className="text-sm text-muted underline" target="_blank">
              {project.youtube_url}
            </a>
          </div>
          <StatusBadge status={status} />
        </div>

        {(status === "queued" || status === "processing") && (
          <Progress projectId={project.id} projectStatus={status} initial={job ?? null} />
        )}
        {status === "expired" && (
          <p className="rounded-md bg-slate-200 p-3 text-sm text-slate-700">{t.project.expired}</p>
        )}
        {status === "failed" && (
          <p className="rounded-md bg-red-100 p-3 text-sm text-red-800">
            {t.project.failed} {project.error ?? t.project.unknownError}
          </p>
        )}

        {clips && clips.length > 0 && (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {clips.map((c) => {
              const video = c.video_path ? signed.get(c.video_path) : undefined;
              const thumb = c.thumbnail_path ? signed.get(c.thumbnail_path) : undefined;
              return (
                <li key={c.id} className="card flex flex-col gap-3 p-3">
                  {video ? (
                    <video
                      src={video}
                      poster={thumb}
                      controls
                      preload="metadata"
                      className="aspect-[9/16] w-full rounded-md bg-black object-contain"
                    />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center rounded-md bg-slate-800 text-xs text-slate-300">
                      {t.project.notUploaded}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold">{c.title ?? `${t.project.clip} ${c.position + 1}`}</h2>
                    {c.virality_score != null && (
                      <span className="shrink-0 rounded bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
                        {Math.round(c.virality_score)}
                      </span>
                    )}
                  </div>
                  {c.hook_text && <p className="text-sm">“{c.hook_text}”</p>}
                  {c.description && <p className="text-xs text-muted">{c.description}</p>}
                  <div className="mt-auto flex items-center justify-between text-xs text-muted">
                    <span>
                      {clock(c.start_seconds)} - {clock(c.end_seconds)}
                    </span>
                    {video && (
                      <a href={`${video}&download=clip-${c.position + 1}.mp4`} className="btn-primary px-3 py-1 text-xs">
                        {t.project.download}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
