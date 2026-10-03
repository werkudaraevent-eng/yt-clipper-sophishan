import Link from "next/link";
import { notFound } from "next/navigation";
import type { JobOptions, ProjectStatus } from "@clipper/shared";
import { AppShell } from "@/components/AppShell";
import { ClipCard } from "@/components/ClipCard";
import { PostToYouTube } from "@/components/PostToYouTube";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { clock } from "@/lib/format";
import { fill } from "@/lib/i18n/dictionaries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { LANGUAGES } from "@/lib/languages";
import { currentUser } from "@/lib/session";
import { CLIPS_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { disconnectYouTube } from "@/lib/youtube-actions";
import { youtubePostingEnabled } from "@/lib/youtube-upload";
import { Progress } from "./progress";

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

const SORTS = ["score", "order", "shortest"] as const;
type Sort = (typeof SORTS)[number];

function sortClips(clips: Clip[], sort: Sort): Clip[] {
  const copy = [...clips];
  if (sort === "score") copy.sort((a, b) => (b.virality_score ?? -1) - (a.virality_score ?? -1));
  if (sort === "order") copy.sort((a, b) => a.start_seconds - b.start_seconds);
  if (sort === "shortest") {
    copy.sort((a, b) => a.end_seconds - a.start_seconds - (b.end_seconds - b.start_seconds));
  }
  return copy;
}

/** "0:42" for a clip length. */
function length(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; youtube?: string }>;
}) {
  const [{ id }, { sort: sortParam, youtube: youtubeResult }] = await Promise.all([params, searchParams]);
  const sort: Sort = (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as Sort) : "score";
  const user = await currentUser();
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, title, youtube_url, youtube_id, thumbnail_url, status, error, options, credits_charged, created_at, expires_at",
    )
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
  // Where a waiting project stands in line, so the first paint already shows it.
  const { data: queue } =
    job?.status === "queued"
      ? await supabase.rpc("queue_position", { p_project_id: id })
      : { data: null };
  const options = project.options as JobOptions;
  const title = project.title ?? t.projects.untitled;
  const cost = project.credits_charged as number;
  const tag = locale === "id" ? "id-ID" : "en-US";
  const running = status === "queued" || status === "processing";
  // The "notify me" switch on the progress card.
  const { data: profile } =
    running && user
      ? await supabase.from("profiles").select("notify_email").eq("id", user.id).maybeSingle()
      : { data: null };
  const language =
    options.videoLanguage === "auto"
      ? t.create.autoDetect
      : (LANGUAGES.find((l) => l.code === options.videoLanguage)?.name ?? options.videoLanguage);
  const settings: [IconName, string][] = [
    ["language", language],
    ["cut", `${t.create.clipLength}: ${t.create.clipLengths[options.clipLength]}`],
    ...(options.captions.enabled
      ? [["subtitles", `${options.captions.template} · ${t.create.positions[options.captions.position]}`] as [IconName, string]]
      : []),
    ["schedule", `${clock(options.timeframe.start)} – ${clock(options.timeframe.end)}`],
  ];

  if (running) {
    return (
      <AppShell user={user} title={title} backHref="/projects">
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Progress projectId={project.id} projectStatus={status} initial={job ?? null} initialQueue={queue?.[0] ?? null}
            notify={profile ? { on: profile.notify_email, email: user?.email ?? null } : null}
          />
          <aside className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-4">
            <a
              href={project.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="relative block aspect-video overflow-hidden rounded-md bg-surface-container-highest"
            >
              {project.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.thumbnail_url} alt="" className="h-full w-full object-cover" />
              )}
              <span className="absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white">
                <Icon name="play" />
                <span className="sr-only">{t.project.openVideo}</span>
              </span>
            </a>
            <h2 className="text-title-m text-on-surface">{title}</h2>
            <div className="flex flex-col gap-3 border-t border-outline-variant pt-4">
              <h3 className="text-label-l text-on-surface-variant">{t.project.settings}</h3>
              <ul className="flex flex-wrap gap-2">
                {settings.map(([icon, label]) => (
                  <li key={label} className="inline-flex h-8 items-center gap-2 rounded-sm border border-outline-variant px-3 text-label-l text-on-surface-variant capitalize">
                    <Icon name={icon} size={18} />
                    {label}
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-2 text-body-s text-on-surface-variant">
                <Icon name="tollFill" size={16} className="text-primary" />
                {fill(t.project.creditsUsed, { n: cost })}
              </p>
            </div>
          </aside>
        </div>
      </AppShell>
    );
  }

  const sorted = sortClips(clips ?? [], sort);

  // YouTube posting: the connected channel, and the latest published post per clip.
  let youtube: { google_email: string | null; channel_title: string | null } | null = null;
  const postedUrls = new Map<string, string>();
  if (youtubePostingEnabled && sorted.length) {
    const [{ data: connection }, { data: posts }] = await Promise.all([
      supabase.from("youtube_connections").select("google_email, channel_title").maybeSingle(),
      supabase
        .from("clip_posts")
        .select("clip_id, external_id")
        .in(
          "clip_id",
          sorted.map((c) => c.id),
        )
        .eq("status", "published")
        .order("created_at", { ascending: false }),
    ]);
    youtube = connection;
    for (const p of posts ?? []) {
      if (p.external_id && !postedUrls.has(p.clip_id)) {
        postedUrls.set(p.clip_id, `https://youtube.com/shorts/${p.external_id}`);
      }
    }
  }
  const youtubeMessage =
    youtubeResult && youtubeResult in t.youtube.results
      ? t.youtube.results[youtubeResult as keyof typeof t.youtube.results]
      : null;
  const projectPath = `/projects/${project.id}`;
  const meta = [
    `${clock(options.timeframe.start)} – ${clock(options.timeframe.end)}`,
    `${clips?.length ?? 0} ${t.projects.clips}`,
    fill(t.project.creditsUsed, { n: cost }),
  ].join(" · ");

  return (
    <AppShell user={user} title={t.project.results} backHref="/projects">
      <>
        <section className="flex flex-col gap-4 rounded-lg bg-surface-container-low p-4 sm:flex-row sm:items-center sm:p-5">
          <a
            href={project.youtube_url}
            target="_blank"
            rel="noreferrer"
            aria-label={t.project.openVideo}
            className="block aspect-video w-full shrink-0 overflow-hidden rounded-md bg-surface-container-highest sm:w-40"
          >
            {project.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.thumbnail_url} alt="" className="h-full w-full object-cover" />
            )}
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-headline-s text-on-surface">{title}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="mt-1 text-body-m text-on-surface-variant tabular-nums">{meta}</p>
            {status === "ready" && project.expires_at && (
              <p className="mt-1 flex items-center gap-1 text-body-s text-on-surface-variant">
                <Icon name="schedule" size={16} />
                {fill(t.project.keptUntil, {
                  date: new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(new Date(project.expires_at)),
                })}
              </p>
            )}
          </div>
          <Link
            href="/#create"
            className="state-layer focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-secondary-container px-6 text-label-l text-on-secondary-container sm:self-center"
          >
            <Icon name="add" size={18} />
            {t.project.makeMore}
          </Link>
        </section>

        {status === "expired" && (
          <p className="flex gap-2 rounded-md bg-surface-container-highest p-3 text-body-m text-on-surface-variant">
            <Icon name="schedule" size={20} className="shrink-0" />
            {t.project.expired}
          </p>
        )}
        {status === "failed" && (
          <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
            <Icon name="error" size={20} className="shrink-0" />
            {t.project.failed} {project.error ?? t.project.unknownError}
          </p>
        )}

        {youtubeMessage && (
          <p
            role="status"
            className={`flex gap-2 rounded-md p-3 text-body-m ${
              youtubeResult === "connected"
                ? "bg-success-container text-on-success-container"
                : "bg-error-container text-on-error-container"
            }`}
          >
            <Icon name={youtubeResult === "connected" ? "checkCircle" : "error"} size={20} className="shrink-0" />
            {youtubeMessage}
          </p>
        )}

        {youtubePostingEnabled && sorted.length > 0 && status === "ready" && (
          <section className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 sm:flex-row sm:items-center">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
              <Icon name="share" size={20} />
            </span>
            {youtube ? (
              <>
                <p className="min-w-0 flex-1 truncate text-body-l text-on-surface">
                  {fill(t.youtube.connectedAs, {
                    name: youtube.channel_title ?? youtube.google_email ?? "YouTube",
                  })}
                </p>
                <form action={disconnectYouTube}>
                  <input type="hidden" name="path" value={projectPath} />
                  <button className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary">
                    {t.youtube.disconnect}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-title-s text-on-surface">{t.youtube.connectTitle}</p>
                  <p className="text-body-s text-on-surface-variant">{t.youtube.connectBody}</p>
                </div>
                <a href={`/api/youtube/connect?next=${encodeURIComponent(projectPath)}`} className="btn-primary">
                  {t.youtube.connect}
                </a>
              </>
            )}
          </section>
        )}

        {sorted.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-body-m text-on-surface-variant">{t.project.sortBy}</span>
              {SORTS.map((s) => (
                <Link
                  key={s}
                  href={`?sort=${s}`}
                  replace
                  scroll={false}
                  aria-pressed={s === sort}
                  className="chip"
                >
                  {s === sort && <Icon name="check" size={18} />}
                  {t.project.sorts[s]}
                </Link>
              ))}
              <span className="ml-auto text-body-m text-on-surface-variant">
                {sorted.length} {t.projects.clips}
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-6">
              {sorted.map((c) => {
                const video = c.video_path ? signed.get(c.video_path) : undefined;
                const thumb = c.thumbnail_path ? signed.get(c.thumbnail_path) : undefined;
                return (
                  <li key={c.id}>
                    <ClipCard
                      className="h-full"
                      media={
                        video ? (
                          <video
                            src={video}
                            poster={thumb}
                            controls
                            preload="metadata"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-4 text-center text-body-s text-white/70">
                            {t.project.notUploaded}
                          </div>
                        )
                      }
                      score={c.virality_score}
                      length={length(c.end_seconds - c.start_seconds)}
                      title={c.title ?? `${t.project.clip} ${c.position + 1}`}
                      hook={c.hook_text}
                      range={`${clock(c.start_seconds)} – ${clock(c.end_seconds)}`}
                      downloadHref={video ? `${video}&download=clip-${c.position + 1}.mp4` : undefined}
                      downloadLabel={t.project.download}
                      actions={
                        youtube && video ? (
                          <PostToYouTube
                            clipId={c.id}
                            defaultTitle={`${c.title ?? `${t.project.clip} ${c.position + 1}`} #Shorts`.slice(0, 100)}
                            defaultDescription={postDescription(
                              c.description ?? c.hook_text ?? "",
                              t.youtube.fullVideo,
                              title,
                              project.youtube_id,
                              c.start_seconds,
                            )}
                            postedUrl={postedUrls.get(c.id)}
                            labels={t.youtube}
                          />
                        ) : undefined
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </>
    </AppShell>
  );
}

/**
 * The clip's description, then a credit line pointing at the moment in the
 * source video (a clean link, without the share tracking in the pasted URL).
 */
function postDescription(
  text: string,
  label: string,
  sourceTitle: string,
  youtubeId: string | null,
  startSeconds: number,
) {
  if (!youtubeId) return text;
  const link = `https://www.youtube.com/watch?v=${youtubeId}&t=${Math.floor(startSeconds)}s`;
  return `${text}\n\n${label}: ${sourceTitle}\n${link}`.trim();
}
