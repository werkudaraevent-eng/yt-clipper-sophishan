import Link from "next/link";
import { PROJECT_STATUSES, type ProjectStatus } from "@clipper/shared";
import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { StatusBadge } from "./StatusBadge";
import { Icon } from "./ui/Icon";

export type ProjectRow = {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  status: ProjectStatus;
  created_at: string;
  clips: { count: number }[];
};

export async function ProjectList({
  q,
  status,
  sort,
  recent,
}: {
  q?: string;
  status?: string;
  sort?: string;
  /** Home page variant: the latest few projects, no filters. */
  recent?: number;
}) {
  const [supabase, t, locale] = await Promise.all([createClient(), getDictionary(), getLocale()]);
  let query = supabase
    .from("projects")
    .select("id, title, thumbnail_url, status, created_at, clips(count)", { count: "exact" })
    .order("created_at", { ascending: sort === "oldest" })
    .limit(recent ?? 50);
  if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
  if (status && (PROJECT_STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  const { data, count, error } = await query.returns<ProjectRow[]>();

  return (
    <section className="flex flex-col gap-4">
      {recent != null ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-l text-on-surface">{t.home.recent}</h2>
          {(count ?? 0) > 0 && (
            <Link
              href="/projects"
              className="state-layer focus-ring inline-flex h-10 items-center rounded-full px-3 text-label-l text-primary"
            >
              {t.projects.seeAll}
            </Link>
          )}
        </div>
      ) : (
        <>
          <form className="flex flex-col gap-3 sm:flex-row">
            <label className="flex h-14 flex-1 items-center gap-3 rounded-full bg-surface-container-high px-4 focus-within:ring-2 focus-within:ring-primary">
              <Icon name="search" className="shrink-0 text-on-surface-variant" />
              <span className="sr-only">{t.projects.search}</span>
              <input
                name="q"
                defaultValue={q}
                placeholder={t.projects.search}
                className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface outline-none placeholder:text-on-surface-variant"
              />
            </label>
            <div className="flex gap-3">
              <select
                name="status"
                defaultValue={status ?? ""}
                className="input h-14 flex-1 sm:w-44"
                aria-label={t.projects.status}
              >
                <option value="">{t.projects.statusAll}</option>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.status[s]}
                  </option>
                ))}
              </select>
              <select
                name="sort"
                defaultValue={sort ?? "newest"}
                className="input h-14 flex-1 sm:w-44"
                aria-label={t.projects.sort}
              >
                <option value="newest">{t.projects.newest}</option>
                <option value="oldest">{t.projects.oldest}</option>
              </select>
              <button className="btn-secondary h-14">{t.projects.apply}</button>
            </div>
          </form>
          <p className="flex items-center gap-2 text-body-s text-on-surface-variant">
            <Icon name="schedule" size={16} />
            {count ?? 0} {t.projects.total.toLowerCase()} · {t.projects.expiry}
          </p>
        </>
      )}

      {error && <p className="text-body-m text-error">{error.message}</p>}
      {!error && data?.length === 0 && (
        <p className="rounded-lg bg-surface-container-low px-4 py-10 text-center text-body-m text-on-surface-variant">
          {t.projects.empty}
        </p>
      )}

      {!!data?.length && <ProjectRows rows={data} locale={locale} t={t} />}
    </section>
  );
}

/** Projects as M3 list items: thumbnail, title, date and clip count, status. */
export function ProjectRows({ rows, locale, t }: { rows: ProjectRow[]; locale: string; t: Dictionary }) {
  return (
    <ul className="flex flex-col gap-1 overflow-hidden rounded-lg">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            className="state-layer focus-ring flex items-center gap-4 bg-surface-container-lowest px-4 py-3 text-on-surface"
          >
            <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest sm:w-28">
              {p.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-l">{p.title ?? t.projects.untitled}</span>
              <span className="block truncate text-body-m text-on-surface-variant">
                {shortDate(p.created_at, locale)} · {p.clips[0]?.count ?? 0} {t.projects.clips}
              </span>
            </span>
            <StatusBadge status={p.status} />
            <Icon name="chevronRight" className="hidden shrink-0 text-on-surface-variant sm:block" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
