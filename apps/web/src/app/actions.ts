"use server";

import { jobOptionsSchema } from "@clipper/shared";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/env";
import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { fetchVideoMeta, youtubeId } from "@/lib/youtube";

/** `code` names a message in the `errors` dictionary; `error` is raw text (validation, database). */
export type CreateProjectState = {
  code?: "notConfigured" | "badForm" | "videoNotFound" | "createFailed" | "insufficientCredits";
  error: string | null;
};

/** Validate the Create form and queue a project; the database trigger enqueues the job. */
export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  if (!supabaseConfigured) return { code: "notConfigured", error: null };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("options") ?? ""));
  } catch {
    return { code: "badForm", error: null };
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
  if (!meta) return { code: "videoNotFound", error: null };

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
  if (error?.message.includes("insufficient_credits")) {
    return { code: "insufficientCredits", error: null };
  }
  if (error || !data) return error ? { error: error.message } : { code: "createFailed", error: null };

  // The worker writes the "clips are ready" email in the language last used.
  await supabase.from("profiles").update({ ui_language: await getLocale() }).eq("id", user.id);

  redirect(`/projects/${data.id}`);
}
