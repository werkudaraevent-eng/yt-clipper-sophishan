import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/session";
import { CLIPS_BUCKET } from "@/lib/storage";
import {
  PRIVACY,
  type Privacy,
  YouTubeError,
  accessToken,
  cleanDescription,
  cleanTitle,
  decryptToken,
  uploadVideo,
  youtubePostingEnabled,
} from "@/lib/youtube-upload";

// A Short is tens of megabytes; streaming it from storage to YouTube takes a while.
export const maxDuration = 300;

/** Posts one of the user's clips to their connected YouTube channel. */
export async function POST(request: Request) {
  if (!youtubePostingEnabled) return Response.json({ code: "disabled" }, { status: 404 });
  const user = await currentUser();
  if (!user) return Response.json({ code: "signedOut" }, { status: 401 });

  const input = (await request.json().catch(() => null)) as {
    clipId?: string;
    title?: string;
    description?: string;
    privacy?: string;
  } | null;
  const privacy = input?.privacy as Privacy;
  if (!input?.clipId || !PRIVACY.includes(privacy)) return Response.json({ code: "badRequest" }, { status: 400 });

  const supabase = await createClient();
  // RLS limits this to the user's own clips.
  const { data: clip } = await supabase.from("clips").select("id, video_path").eq("id", input.clipId).maybeSingle();
  if (!clip?.video_path || clip.video_path.startsWith("/")) {
    return Response.json({ code: "notFound" }, { status: 404 });
  }

  const { data: sealed } = await supabase.rpc("youtube_refresh_token");
  if (!sealed) return Response.json({ code: "reconnect" }, { status: 409 });

  const { data: post, error: postError } = await supabase
    .from("clip_posts")
    .insert({ clip_id: clip.id, user_id: user.id, privacy })
    .select("id")
    .single();
  if (postError || !post) return Response.json({ code: "failed" }, { status: 500 });

  const finish = (fields: { status: string; external_id?: string; error?: string }) =>
    supabase
      .from("clip_posts")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", post.id);

  try {
    const token = await accessToken(decryptToken(sealed as string));
    const { data: signed } = await supabase.storage.from(CLIPS_BUCKET).createSignedUrl(clip.video_path, 600);
    const file = signed ? await fetch(signed.signedUrl) : null;
    const size = Number(file?.headers.get("content-length"));
    if (!file?.ok || !file.body || !size) throw new YouTubeError("failed", "clip file not readable");

    const video = await uploadVideo(
      token,
      { body: file.body, size },
      {
        title: cleanTitle(input.title ?? ""),
        description: cleanDescription(input.description ?? ""),
        privacy,
      },
    );
    await finish({ status: "published", external_id: video.id });
    if (video.channelTitle) await supabase.rpc("set_youtube_channel_title", { title: video.channelTitle });
    return Response.json({ id: video.id, url: `https://youtube.com/shorts/${video.id}` });
  } catch (e) {
    const code = e instanceof YouTubeError ? e.code : "failed";
    console.error("youtube upload failed", e);
    await finish({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
    if (code === "reconnect") await supabase.from("youtube_connections").delete().eq("user_id", user.id);
    return Response.json({ code }, { status: code === "reconnect" ? 409 : 502 });
  }
}
