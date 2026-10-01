"use server";

import { revalidatePath } from "next/cache";
import { schedulingEnabled, signedToken } from "./scheduler";
import { currentUser } from "./session";
import { CLIPS_BUCKET } from "./storage";
import { createClient } from "./supabase/server";
import { PRIVACY, type Privacy, cleanDescription, cleanTitle } from "./youtube-upload";

export type ScheduleItem = { clipId: string; at: string; title: string; description: string };
export type ScheduleCode = "badTime" | "alreadyPosted" | "reconnect" | "notFound" | "failed";
export type ScheduleResult = { clipId: string; ok: true } | { clipId: string; ok: false; code: ScheduleCode };

/** The signed link stays valid this long after the post is due, for retries. */
const LINK_GRACE_SECONDS = 3 * 24 * 3600;

function codeOf(message: string): ScheduleCode {
  if (message.includes("bad_time")) return "badTime";
  if (message.includes("already_posted")) return "alreadyPosted";
  if (message.includes("reconnect")) return "reconnect";
  if (message.includes("not_found")) return "notFound";
  return "failed";
}

/**
 * Queues clips (or moves already queued ones). For each clip it signs a link
 * to the file with the user's own session, so the cron can read it later.
 */
export async function scheduleClips(items: ScheduleItem[], privacy: Privacy): Promise<ScheduleResult[]> {
  const user = await currentUser();
  if (!schedulingEnabled || !user || !PRIVACY.includes(privacy) || !Array.isArray(items) || items.length > 20) {
    return (Array.isArray(items) ? items : []).map((i) => ({ clipId: String(i?.clipId), ok: false, code: "failed" }));
  }
  const supabase = await createClient();
  const results: ScheduleResult[] = [];
  for (const item of items) {
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime())) {
      results.push({ clipId: item.clipId, ok: false, code: "badTime" });
      continue;
    }
    // RLS limits this to the user's own clips.
    const { data: clip } = await supabase
      .from("clips")
      .select("id, video_path")
      .eq("id", item.clipId)
      .maybeSingle();
    if (!clip?.video_path || clip.video_path.startsWith("/")) {
      results.push({ clipId: item.clipId, ok: false, code: "notFound" });
      continue;
    }
    const seconds = Math.max(0, Math.ceil((at.getTime() - Date.now()) / 1000)) + LINK_GRACE_SECONDS;
    const { data: signed } = await supabase.storage.from(CLIPS_BUCKET).createSignedUrl(clip.video_path, seconds);
    const token = signed ? signedToken(signed.signedUrl) : null;
    if (!token) {
      results.push({ clipId: item.clipId, ok: false, code: "failed" });
      continue;
    }
    const { error } = await supabase.rpc("schedule_clip_post", {
      p_clip: clip.id,
      p_at: at.toISOString(),
      p_privacy: privacy,
      p_title: cleanTitle(String(item.title ?? "")),
      p_description: cleanDescription(String(item.description ?? "")),
      p_file_token: token,
    });
    results.push(error ? { clipId: item.clipId, ok: false, code: codeOf(error.message) } : { clipId: item.clipId, ok: true });
  }
  revalidatePath("/schedule");
  return results;
}

/** Takes a queued or failed post off the schedule. */
export async function cancelScheduledPost(postId: string) {
  if (!(await currentUser())) return;
  const supabase = await createClient();
  await supabase.rpc("cancel_clip_post", { p_post: postId });
  revalidatePath("/schedule");
}

/** How "Schedule several" spreads clips: one or two a day, and whether only at busy hours. */
export async function savePostRhythm(perDay: 1 | 2, peakOnly: boolean) {
  const user = await currentUser();
  if (!user || (perDay !== 1 && perDay !== 2)) return;
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ post_per_day: perDay, post_peak_only: Boolean(peakOnly) })
    .eq("id", user.id);
  revalidatePath("/schedule");
}
