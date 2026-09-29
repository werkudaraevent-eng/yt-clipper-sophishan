"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/session";
import { decryptToken, revoke } from "@/lib/youtube-upload";

/** Revokes the Google grant and deletes the stored token. */
export async function disconnectYouTube(formData: FormData) {
  const user = await currentUser();
  if (!user) return;
  const supabase = await createClient();
  const { data: sealed } = await supabase.rpc("youtube_refresh_token");
  if (sealed) {
    try {
      await revoke(decryptToken(sealed as string));
    } catch {
      // A token we cannot decrypt is useless anyway; still delete it.
    }
  }
  await supabase.from("youtube_connections").delete().eq("user_id", user.id);
  const path = String(formData.get("path") ?? "");
  if (path.startsWith("/")) revalidatePath(path);
}
