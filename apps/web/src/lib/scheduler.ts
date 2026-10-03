import { createClient as createPlainClient } from "@supabase/supabase-js";
import { busyMap, type BusyMap } from "@clipper/shared";
import { CLIPS_BUCKET } from "./storage";
import { createClient } from "./supabase/server";
import { youtubePostingEnabled } from "./youtube-upload";

/**
 * Scheduled posting. The user queues clips (schedule_clip_post); a Vercel
 * cron job (/api/cron/scheduled-posts) uploads them when they are due. The
 * cron has no user session, so it talks to Postgres through functions that
 * take CRON_SECRET, whose SHA-256 is stored in private.settings.
 */
const CRON_SECRET = process.env.CRON_SECRET;

/** Queueing only makes sense when the cron that empties the queue can run. */
export const schedulingEnabled = youtubePostingEnabled && Boolean(CRON_SECRET);

/** Scheduling is allowed up to 30 days ahead, and up to an hour before the clip is deleted. */
const MAX_AHEAD_MS = 30 * 24 * 3600_000;

/** What the scheduling UI needs about the signed-in user. Plain JSON, for client components. */
export type SchedulingContext = {
  map: BusyMap;
  /** Queued posts: clip and time, so suggestions avoid them. */
  queued: { clipId: string; at: string }[];
  perDay: 1 | 2;
  peakOnly: boolean;
};

export async function loadSchedulingContext(userId: string): Promise<SchedulingContext> {
  const supabase = await createClient();
  const [{ data: stats }, { data: queued }, { data: profile }] = await Promise.all([
    supabase
      .from("clip_posts")
      .select("published_at, views_24h")
      .eq("status", "published")
      .not("views_24h", "is", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(200),
    supabase.from("clip_posts").select("clip_id, scheduled_at").eq("status", "scheduled"),
    supabase.from("profiles").select("post_per_day, post_peak_only").eq("id", userId).maybeSingle(),
  ]);
  return {
    map: busyMap((stats ?? []).map((s) => ({ at: s.published_at as string, views: s.views_24h as number }))),
    queued: (queued ?? []).map((q) => ({ clipId: q.clip_id, at: q.scheduled_at as string })),
    perDay: profile?.post_per_day === 2 ? 2 : 1,
    peakOnly: profile?.post_peak_only ?? true,
  };
}

/** The latest a clip from a project expiring at `expiresAt` can be scheduled. */
export function scheduleUntil(expiresAt: string | null, now = Date.now()): string {
  const ahead = now + MAX_AHEAD_MS;
  const beforeExpiry = expiresAt ? new Date(expiresAt).getTime() - 3600_000 : ahead;
  return new Date(Math.min(ahead, beforeExpiry)).toISOString();
}

/** The token part of a signed storage URL. */
export function signedToken(signedUrl: string): string | null {
  try {
    return new URL(signedUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

/** A signed URL for a clip file, rebuilt from its storage path and a stored token. */
export function signedClipUrl(videoPath: string, token: string): string {
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/${CLIPS_BUCKET}/`;
  return `${encodeURI(base + videoPath)}?token=${encodeURIComponent(token)}`;
}

/** Postgres for the cron: the anon key, no session; every call passes CRON_SECRET. */
export function cronDb() {
  return createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function cronSecret() {
  return CRON_SECRET;
}
