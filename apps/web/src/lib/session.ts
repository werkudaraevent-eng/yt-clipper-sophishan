import type { User } from "@supabase/supabase-js";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function currentUser(): Promise<User | null> {
  if (!supabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user's remaining credits, or null when signed out. */
export async function currentCredits(user: User | null): Promise<number | null> {
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("credits_remaining")
    .eq("id", user.id)
    .maybeSingle();
  return data?.credits_remaining ?? null;
}
