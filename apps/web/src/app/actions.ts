"use server";

import { jobOptionsSchema } from "@clipper/shared";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { fetchVideoMeta, youtubeId } from "@/lib/youtube";

export type CreateProjectState = { error: string | null };

/** Validate the Create form and queue a project; the database trigger enqueues the job. */
export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  if (!supabaseConfigured) return { error: "Supabase is not configured on this server." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("options") ?? ""));
  } catch {
    return { error: "Could not read the form." };
  }
  const parsed = jobOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const options = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/");

  const id = youtubeId(options.youtubeUrl);
  const meta = id ? await fetchVideoMeta(id) : null;
  if (!meta) return { error: "That video could not be found or is not public." };

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      youtube_url: options.youtubeUrl,
      youtube_id: meta.id,
      title: meta.title,
      thumbnail_url: meta.thumbnail,
      duration_seconds: meta.duration,
      video_language: options.videoLanguage === "auto" ? null : options.videoLanguage,
      options,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the project." };

  redirect(`/projects/${data.id}`);
}
