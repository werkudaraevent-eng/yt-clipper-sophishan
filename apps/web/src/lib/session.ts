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
