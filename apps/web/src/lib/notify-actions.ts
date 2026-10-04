"use server";

import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/session";

/** The "Notify me when clips are ready" switch: the worker emails when it is on. */
export async function setNotifyEmail(on: boolean) {
  const user = await currentUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.from("profiles").update({ notify_email: on }).eq("id", user.id);
}
