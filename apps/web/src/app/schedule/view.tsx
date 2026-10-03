import Link from "next/link";
import { Thumb } from "@/components/BulkSchedule";
import { BusyHours, LearningCard } from "@/components/BusyHours";
import { RhythmCard } from "@/components/RhythmCard";
import { ScheduleRowActions, type RowPost } from "@/components/ScheduleRowActions";
import { Icon, type IconName } from "@/components/ui/Icon";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { scheduleUntil, type SchedulingContext } from "@/lib/scheduler";
import { relativeDay, wibClock, wibDay, wibInputs } from "@/lib/schedule-format";

type Privacy = RowPost["privacy"];
export type PostRow = {
  id: string;
  clip_id: string;
  status: RowPost["status"];
  scheduled_at: string | null;
  published_at: string | null;
  updated_at: string;
  title: string | null;
  description: string | null;
  privacy: Privacy;
  external_id: string | null;
  error_code: string | null;
  views_24h: number | null;
  clips: {
    title: string | null;
    position: number;
    thumbnail_path: string | null;
    projects: { title: string | null; expires_at: string | null } | null;
  } | null;
};

const CHIP: Record<RowPost["status"], { icon: IconName; className: string }> = {
  scheduled: { icon: "hourglass", className: "bg-surface-container-highest text-on-surface-variant" },
  uploading: { icon: "hourglass", className: "bg-secondary-container text-on-secondary-container" },
  failed: { icon: "error", className: "bg-error-container text-on-error-container" },
  published: { icon: "checkCircle", className: "bg-success-container text-on-success-container" },
};

/**
 * J4: the posting queue. Posts that need the user first, then the queue by
 * WIB day, then the latest live Shorts with their first-day views. On wide
 * windows the busy-hours map and the auto pace sit in a side column.
 */
export function ScheduleView({
  queue,
  published,
  thumbs,
  connection,
  context,
  youtubeResult,
  t,
  locale,
  now,
}: {
  queue: PostRow[];
  published: PostRow[];
  /** Signed thumbnail URLs by storage path. */
  thumbs: Map<string, string>;
  connection: { channel_title: string | null; google_email: string | null } | null;
  context: SchedulingContext;
  youtubeResult?: string;
  t: Dictionary;
  locale: string;
  now: Date;
}) {
  const failed = queue
    .filter((p) => p.status === "failed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const days = new Map<string, PostRow[]>();
  for (const p of queue) {
    if (p.status === "failed") continue;
    const key = wibInputs(p.scheduled_at!).date;
    days.set(key, [...(days.get(key) ?? []), p]);
  }
  const channel = connection?.channel_title ?? connection?.google_email ?? null;
  const youtubeMessage =
    youtubeResult && youtubeResult in t.youtube.results
      ? t.youtube.results[youtubeResult as keyof typeof t.youtube.results]
      : null;

  const dayLabel = (at: string) => {
    const relative = relativeDay(at, now, { today: t.youtube.today, tomorrow: t.youtube.tomorrow });
    return relative ? `${relative} · ${wibDay(at, locale)}` : wibDay(at, locale);
  };
  const when = (at: string) => `${wibDay(at, locale)} · ${wibClock(at, locale)}`;
  const views = new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US");

  function Row({ post }: { post: PostRow }) {
    const clipTitle = post.clips?.title ?? `${t.project.clip} ${(post.clips?.position ?? 0) + 1}`;
    const row: RowPost = {
      id: post.id,
      clipId: post.clip_id,
      status: post.status,
      at: post.scheduled_at,
      title: post.title ?? `${clipTitle} #Shorts`.slice(0, 100),
      description: post.description ?? "",
      privacy: post.privacy,
      externalId: post.external_id,
      needsReconnect: !connection && (post.error_code === "reconnect" || post.error_code === "scope"),
    };
    const scheduling = {
      map: context.map,
      taken: context.queued.filter((q) => q.clipId !== post.clip_id).map((q) => q.at),
      until: scheduleUntil(post.clips?.projects?.expires_at ?? null),
    };
    const labels = { schedule: t.schedule, youtube: t.youtube };
    const chip = CHIP[post.status];
    const privacy = t.youtube.privacies[post.privacy];
    const project = post.clips?.projects?.title ?? t.projects.untitled;
    const reason =
      t.schedule.failReasons[post.error_code as keyof typeof t.schedule.failReasons] ?? t.schedule.failReasons.failed;

    return (
      <li className="flex items-center gap-3 py-2.5 sm:gap-4 sm:py-3">
        <Thumb
          src={post.clips?.thumbnail_path ? thumbs.get(post.clips.thumbnail_path) : undefined}
          className="h-12 w-[27px] rounded-[4px] sm:h-16 sm:w-9 sm:rounded-[6px]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="line-clamp-2 text-title-s text-on-surface sm:line-clamp-1 sm:text-title-m">{clipTitle}</p>
          {post.status === "failed" ? (
            <p className="text-body-s text-error">
              {fill(t.schedule.failedAt, { when: when(post.updated_at) })} {reason}
            </p>
          ) : post.status === "published" ? (
            <p className="text-body-s text-on-surface-variant tabular-nums">{when(post.published_at!)}</p>
          ) : (
            <p className="truncate text-body-s text-on-surface-variant">
              <span className="sm:hidden">{t.schedule.status[post.status]} · </span>
              <span className="hidden sm:inline">{project} · </span>
              {privacy}
            </p>
          )}
          {post.status === "failed" && (
            <div className="sm:hidden">
              <ScheduleRowActions post={row} scheduling={scheduling} labels={labels} locale={locale} variant="inline" />
            </div>
          )}
        </div>
        {post.status === "published" ? (
          <div className="shrink-0 text-right">
            {post.views_24h != null ? (
              <>
                <p className="text-title-s text-on-surface tabular-nums sm:text-title-m">
                  {fill(t.schedule.views, { n: views.format(post.views_24h) })}
                </p>
                <p className="text-body-s text-on-surface-variant">{t.schedule.firstDay}</p>
              </>
            ) : (
              <p className="text-body-s text-on-surface-variant">{t.schedule.counting}</p>
            )}
          </div>
        ) : (
          post.status !== "failed" && (
            <time
              dateTime={post.scheduled_at!}
              className="shrink-0 text-title-m text-on-surface tabular-nums sm:text-title-l"
            >
              {wibClock(post.scheduled_at!, locale)}
            </time>
          )
        )}
        <span
          className={`hidden h-6 shrink-0 items-center gap-1 rounded-sm pr-2 pl-1.5 text-label-m sm:inline-flex ${chip.className}`}
        >
          <Icon name={chip.icon} size={16} />
          {t.schedule.status[post.status]}
        </span>
        <ScheduleRowActions post={row} scheduling={scheduling} labels={labels} locale={locale} />
      </li>
    );
  }

  function Group({ label, posts, tone = "default" }: { label: string; posts: PostRow[]; tone?: "default" | "error" }) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className={`text-title-s ${tone === "error" ? "text-error" : "text-on-surface"}`}>{label}</h3>
        <ul className="flex flex-col divide-y divide-outline-variant rounded-lg bg-surface-container-low py-1 pr-1 pl-3 sm:pr-2 sm:pl-4">
          {posts.map((p) => (
            <Row key={p.id} post={p} />
          ))}
        </ul>
      </section>
    );
  }

  const empty = failed.length === 0 && days.size === 0;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h2 className="text-headline-s text-on-surface">{t.schedule.title}</h2>
        <p className="text-body-m text-on-surface-variant">
          {channel ? (
            <>
              {fill(t.schedule.intro, { channel })}
              <span className="hidden sm:inline"> {t.schedule.introMore}</span>
            </>
          ) : (
            t.schedule.introNoChannel
          )}
        </p>
      </header>

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

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-4">
        <div className="lg:col-start-2 lg:row-start-1">
          {context.map.learned ? (
            <BusyHours map={context.map} labels={t.schedule} />
          ) : (
            <LearningCard samples={context.map.samples} labels={t.schedule} />
          )}
        </div>

        <div className="flex flex-col gap-5 sm:gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {!connection && (
            <a
              href={`/api/youtube/connect?next=${encodeURIComponent("/schedule")}`}
              className="btn-primary self-start"
            >
              {t.youtube.connect}
            </a>
          )}
          {failed.length > 0 && <Group label={t.schedule.needsAction} posts={failed} tone="error" />}
          {[...days].map(([key, posts]) => (
            <Group key={key} label={dayLabel(posts[0].scheduled_at!)} posts={posts} />
          ))}
          {empty && (
            <div className="flex flex-col items-start gap-4 rounded-lg bg-surface-container-low p-6">
              <Icon name="calendarMonth" size={32} className="text-on-surface-variant" />
              <p className="text-body-l text-on-surface">{t.schedule.empty}</p>
              <Link href="/projects" className="btn-primary">
                {t.schedule.openProjects}
              </Link>
            </div>
          )}
          {published.length > 0 && <Group label={t.schedule.posted} posts={published} />}
        </div>

        <div className="lg:col-start-2 lg:row-start-2">
          <RhythmCard perDay={context.perDay} peakOnly={context.peakOnly} labels={t.schedule} />
        </div>
      </div>
    </>
  );
}
