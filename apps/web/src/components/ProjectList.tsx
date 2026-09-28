import Link from "next/link";
import { PROJECT_STATUSES, type ProjectStatus } from "@clipper/shared";
import { createClient } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { getDictionary } from "@/lib/i18n/server";
import { StatusBadge } from "./StatusBadge";

type Row = {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  status: ProjectStatus;
  created_at: string;
  options: { timeframe?: { start: number; end: number } };
  clips: { count: number }[];
};

export async function ProjectList({
  q,
  status,
  sort,
}: {
  q?: string;
  status?: string;
  sort?: string;
}) {
  const [supabase, t] = await Promise.all([createClient(), getDictionary()]);
  let query = supabase
    .from("projects")
    .select("id, title, thumbnail_url, status, created_at, options, clips(count)", {
      count: "exact",
    })
    .order("created_at", { ascending: sort === "oldest" })
    .limit(50);
  if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
  if (status && (PROJECT_STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  const { data, count, error } = await query.returns<Row[]>();

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t.projects.title}</h2>
        <span className="rounded bg-background px-2 py-0.5 text-xs font-semibold">
          {count ?? 0} {t.projects.total}
        </span>
      </div>
      <p className="text-xs text-muted">{t.projects.expiry}</p>

      <form className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <input name="q" defaultValue={q} placeholder={t.projects.search} className="input" />
        <select name="status" defaultValue={status ?? ""} className="input" aria-label={t.projects.status}>
          <option value="">{t.projects.statusAll}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort ?? "newest"} className="input" aria-label={t.projects.sort}>
          <option value="newest">{t.projects.newest}</option>
          <option value="oldest">{t.projects.oldest}</option>
        </select>
        <button className="btn-secondary">{t.projects.apply}</button>
      </form>

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {!error && data?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">{t.projects.empty}</p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {data?.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="block overflow-hidden rounded-lg border border-border hover:border-accent">
              <div className="relative aspect-video bg-slate-800">
                {p.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                )}
                {p.options.timeframe && (
                  <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white">
                    {clock(p.options.timeframe.start)} - {clock(p.options.timeframe.end)}
                  </span>
                )}
                <span className="absolute right-2 bottom-2">
                  <StatusBadge status={p.status} />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 p-3">
                <span className="line-clamp-2 text-sm font-medium">{p.title ?? t.projects.untitled}</span>
                <span className="shrink-0 text-xs text-muted">
                  {p.clips[0]?.count ?? 0} {t.projects.clips}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
