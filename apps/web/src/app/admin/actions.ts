"use server";

import { revalidatePath } from "next/cache";
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

const PRICING_ERRORS = ["one_featured", "price_too_low", "no_active_pack", "not_owner", "promo_exists"] as const;
export type PricingError = (typeof PRICING_ERRORS)[number] | "bad_promo" | "failed";
export type PricingResult = { ok: true } | { error: PricingError };

function pricingError(error: { code?: string; message: string }): PricingError {
  if (error.code === "23505") return "promo_exists";
  // Check constraints and bad casts: a code or value the form let through.
  if (error.code === "23514" || error.code === "22P02") return "bad_promo";
  return PRICING_ERRORS.find((e) => error.message.includes(e)) ?? "failed";
}

function revalidatePricing() {
  revalidatePath("/admin");
  revalidatePath("/credits");
  revalidatePath("/");
  revalidatePath("/login");
}

export type PackInput = {
  id: string | null;
  credits: number;
  price_idr: number;
  discount_percent: number;
  featured: boolean;
  active: boolean;
};

export type SettingsInput = {
  signup_credits: number;
  discount_until: string | null;
  referral_enabled: boolean;
  referral_reward: number;
  referral_signup_bonus: number;
};

/** Save packs (in display order) and settings; the database allows this for the owner only. */
export async function savePricing(packs: PackInput[], settings: SettingsInput): Promise<PricingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_pricing", { p_packs: packs, p_settings: settings });
  if (error) return { error: pricingError(error) };
  revalidatePricing();
  return { ok: true };
}

export type PromoInput = {
  id: string | null;
  code: string;
  kind: "percent" | "amount";
  value: number;
  pack_id: string | null;
  max_uses: number | null;
  per_user_limit: number;
  expires_at: string | null;
  active: boolean;
};

export async function savePromo(promo: PromoInput): Promise<PricingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_promo", { p: promo });
  if (error) return { error: pricingError(error) };
  revalidatePricing();
  return { ok: true };
}

export async function setPromoActive(id: string, active: boolean): Promise<PricingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_promo_active", { p_id: id, p_active: active });
  if (error) return { error: pricingError(error) };
  revalidatePricing();
  return { ok: true };
}
