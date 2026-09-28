"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Add (or, with a negative amount, deduct) credits for one user; the database checks admin rights. */
export async function adjustCredits(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").slice(0, 200);
  const back = (params: Record<string, string>) =>
    redirect(`/admin?${new URLSearchParams({ email, ...params })}`);

  if (!Number.isInteger(amount) || amount === 0) back({ error: "badAmount" });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_adjust_credits", {
    target_user: userId,
    delta: amount,
    note,
  });
  if (error) back({ error: error.code === "23514" ? "belowZero" : "failed" });
  back({ balance: String(data) });
}
