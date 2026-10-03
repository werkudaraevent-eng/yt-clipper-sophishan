import { createHash, timingSafeEqual } from "node:crypto";
import { cronDb, cronSecret, schedulingEnabled, signedClipUrl } from "@/lib/scheduler";
import {
  PRIVACY,
  type Privacy,
  YouTubeError,
  accessToken,
  cleanDescription,
  cleanTitle,
  decryptToken,
  uploadVideo,
} from "@/lib/youtube-upload";

// Each Short streams from storage to YouTube; leave room for a few per run.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Stop claiming new posts after this long, so the one in flight can finish. */
const CLAIM_BUDGET_MS = 180_000;

type DuePost = {
  post_id: string;
  post_user_id: string;
  video_path: string | null;
  title: string | null;
  description: string | null;
  privacy: string;
  file_token: string | null;
  attempts: number;
  refresh_token_enc: string | null;
};

type Db = ReturnType<typeof cronDb>;

/**
 * Runs every minute (vercel.json): uploads scheduled posts that are due, then
 * records 24-hour view counts for recent Shorts. Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret || !sameSecret(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!schedulingEnabled) return Response.json({ skipped: true });

  const db = cronDb();
  const started = Date.now();
  const results: string[] = [];
  while (Date.now() - started < CLAIM_BUDGET_MS) {
    const { data, error } = await db.rpc("claim_due_clip_post", { p_token: secret });
    if (error) throw new Error(`claim_due_clip_post: ${error.message}`);
    const post = (data as DuePost[] | null)?.[0];
    if (!post) break;
    results.push(await publish(db, secret, post));
  }
  const views = await collectViews(db, secret);
  return Response.json({ posts: results, views });
}

/** Constant-time comparison, so response timing says nothing about the secret. */
function sameSecret(given: string | null, expected: string) {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return given != null && timingSafeEqual(digest(given), digest(expected));
}

async function publish(db: Db, secret: string, post: DuePost): Promise<string> {
  const finish = async (status: "published" | "failed" | "retry", fields: Record<string, string | null> = {}) => {
    const { error } = await db.rpc("finish_clip_post", {
      p_token: secret,
      p_post: post.post_id,
      p_status: status,
      p_external_id: fields.externalId ?? null,
      p_error_code: fields.code ?? null,
      p_error: fields.error ?? null,
      p_channel_title: fields.channel ?? null,
    });
    if (error) console.error("finish_clip_post failed", post.post_id, error.message);
    return status;
  };

  if (!post.refresh_token_enc) return finish("failed", { code: "reconnect", error: "no YouTube connection" });
  if (!post.video_path || !post.file_token || !PRIVACY.includes(post.privacy as Privacy)) {
    return finish("failed", { code: "failed", error: "post is missing its file or privacy" });
  }

  try {
    const token = await accessToken(decryptToken(post.refresh_token_enc));
    const file = await fetch(signedClipUrl(post.video_path, post.file_token));
    const size = Number(file.headers.get("content-length"));
    if (!file.ok || !file.body || !size) throw new YouTubeError("failed", `clip file not readable (${file.status})`);
    const video = await uploadVideo(
      token,
      { body: file.body, size },
      {
        title: cleanTitle(post.title ?? ""),
        description: cleanDescription(post.description ?? ""),
        privacy: post.privacy as Privacy,
      },
    );
    return finish("published", { externalId: video.id, channel: video.channelTitle });
  } catch (e) {
    const code = e instanceof YouTubeError ? e.code : "failed";
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("scheduled upload failed", post.post_id, e);
    // A plain failure (network, YouTube hiccup) gets one more try later; an
    // expired grant or a used-up quota needs the user.
    return finish(code === "failed" && post.attempts < 2 ? "retry" : "failed", { code, error: message });
  }
}

/** Saves view counts of Shorts that went up about a day ago. Needs YOUTUBE_API_KEY. */
async function collectViews(db: Db, secret: string): Promise<number> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return 0;
  const { data, error } = await db.rpc("due_clip_post_stats", { p_token: secret, p_limit: 50 });
  if (error) {
    console.error("due_clip_post_stats failed", error.message);
    return 0;
  }
  const due = (data ?? []) as { post_id: string; external_id: string }[];
  if (!due.length) return 0;

  const params = new URLSearchParams({ part: "statistics", id: due.map((d) => d.external_id).join(","), key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!res.ok) {
    console.error("videos.list failed", res.status, (await res.text()).slice(0, 300));
    return 0;
  }
  const json = (await res.json()) as { items?: { id: string; statistics?: { viewCount?: string } }[] };
  const counts = new Map((json.items ?? []).map((v) => [v.id, Number(v.statistics?.viewCount)]));
  const found = due.filter((d) => Number.isFinite(counts.get(d.external_id)));
  if (!found.length) return 0;
  const { error: saveError } = await db.rpc("save_clip_post_views", {
    p_token: secret,
    p_posts: found.map((d) => d.post_id),
    p_views: found.map((d) => Math.round(counts.get(d.external_id)!)),
  });
  if (saveError) console.error("save_clip_post_views failed", saveError.message);
  return saveError ? 0 : found.length;
}
