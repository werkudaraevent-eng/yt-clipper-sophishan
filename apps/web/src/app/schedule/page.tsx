import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { loadSchedulingContext, schedulingEnabled } from "@/lib/scheduler";
import { currentUser } from "@/lib/session";
import { CLIPS_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { ScheduleView, type PostRow } from "./view";

export async function generateMetadata() {
  const t = await getDictionary();
  return { title: `${t.schedule.title} · Sophishan Clipper` };
}

const POST_FIELDS =
  "id, clip_id, status, scheduled_at, published_at, updated_at, title, description, privacy, external_id, error_code, views_24h, clips(title, position, thumbnail_path, projects(title, expires_at))";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ youtube?: string }> }) {
  if (!schedulingEnabled) notFound();
  const user = await currentUser();
  if (!user) redirect("/login?next=/schedule");
  const [{ youtube: youtubeResult }, t, locale] = await Promise.all([searchParams, getDictionary(), getLocale()]);
  const supabase = await createClient();

  const [{ data: connection }, { data: queue }, { data: published }, context] = await Promise.all([
    supabase.from("youtube_connections").select("channel_title, google_email").maybeSingle(),
    supabase
      .from("clip_posts")
      .select(POST_FIELDS)
      .in("status", ["scheduled", "uploading", "failed"])
      .not("scheduled_at", "is", null)
      .order("scheduled_at")
      .limit(100)
      .returns<PostRow[]>(),
    supabase
      .from("clip_posts")
      .select(POST_FIELDS)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(10)
      .returns<PostRow[]>(),
    loadSchedulingContext(user.id),
  ]);

  const rows = [...(queue ?? []), ...(published ?? [])];
  const thumbPaths = [...new Set(rows.map((r) => r.clips?.thumbnail_path).filter((p): p is string => Boolean(p)))];
  const thumbs = new Map<string, string>();
  if (thumbPaths.length) {
    const { data } = await supabase.storage.from(CLIPS_BUCKET).createSignedUrls(thumbPaths, 3600);
    data?.forEach((d) => d.signedUrl && d.path && thumbs.set(d.path, d.signedUrl));
  }

  return (
    <AppShell user={user} title={t.nav.schedule}>
      <ScheduleView
        queue={queue ?? []}
        published={published ?? []}
        thumbs={thumbs}
        connection={connection}
        context={context}
        youtubeResult={youtubeResult}
        t={t}
        locale={locale}
        now={new Date()}
      />
    </AppShell>
  );
}
