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

/** Make a user an admin, or back to a regular user; the database allows this for the owner only. */
export async function setRole(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const role = formData.get("role") === "admin" ? "admin" : "user";
  const back = (params: Record<string, string>) =>
    redirect(`/admin?${new URLSearchParams({ tab: "team", ...params })}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role", { target_email: email, new_role: role });
  if (error) {
    const code = error.code === "P0002" ? "notFound" : error.message === "owner_locked" ? "locked" : "failed";
    back({ error: code });
  }
  back({ [role === "admin" ? "added" : "removed"]: email });
}
