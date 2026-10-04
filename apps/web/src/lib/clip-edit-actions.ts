"use server";

import { revalidatePath } from "next/cache";
import { clipEditSchema, type ClipEdit } from "@clipper/shared";
import { currentUser } from "./session";
import { createClient } from "./supabase/server";

export type EditCode = "buyersOnly" | "badTrim" | "inProgress" | "tooMany" | "notReady" | "failed";
export type TermCode = "buyersOnly" | "badTerm" | "tooMany" | "failed";

function editCode(message: string): EditCode {
  if (message.includes("buyers_only")) return "buyersOnly";
  if (message.includes("bad_trim")) return "badTrim";
  if (message.includes("edit_in_progress")) return "inProgress";
  if (message.includes("too_many_edits")) return "tooMany";
  if (message.includes("not_ready")) return "notReady";
  return "failed";
}

function termCode(message: string): TermCode {
  if (message.includes("buyers_only")) return "buyersOnly";
  if (message.includes("bad_term")) return "badTerm";
  if (message.includes("too_many_terms")) return "tooMany";
  return "failed";
}

/**
 * Queues a re-render of the clip with the edit; edit_clip checks ownership,
 * what free accounts may change and the trim limits. With `styleToAll` the
 * edit's style also goes to the project's other clips.
 */
export async function saveClipEdit(
  clipId: string,
  edit: ClipEdit,
  styleToAll: boolean,
): Promise<{ ok: true } | { ok: false; code: EditCode }> {
  const parsed = clipEditSchema.safeParse(edit);
  if (!(await currentUser()) || !parsed.success) return { ok: false, code: "failed" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_clip", {
    p_clip: clipId,
    p_edit: parsed.data,
    p_style_to_all: Boolean(styleToAll && parsed.data.style),
  });
  if (error) return { ok: false, code: editCode(error.message) };
  const { data: clip } = await supabase.from("clips").select("project_id").eq("id", clipId).maybeSingle();
  if (clip) revalidatePath(`/projects/${clip.project_id}`);
  return { ok: true };
}

/** Adds a name to the buyer's dictionary, or changes how it is written. */
export async function saveTerm(
  wrong: string,
  correct: string,
): Promise<{ ok: true; id: number } | { ok: false; code: TermCode }> {
  if (!(await currentUser())) return { ok: false, code: "failed" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_term", {
    p_wrong: String(wrong).slice(0, 200),
    p_correct: String(correct).slice(0, 200),
  });
  if (error) return { ok: false, code: termCode(error.message) };
  return { ok: true, id: Number(data) };
}

export async function deleteTerm(id: number) {
  if (!(await currentUser())) return;
  const supabase = await createClient();
  await supabase.rpc("delete_term", { p_id: id });
}
