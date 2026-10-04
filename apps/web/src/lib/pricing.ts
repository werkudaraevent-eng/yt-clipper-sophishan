import { supabaseConfigured } from "./env";
import { createClient } from "./supabase/server";

/** The one row of public.pricing_settings, set by the owner on /admin. */
export type PricingSettings = {
  signup_credits: number;
  discount_until: string | null;
  referral_enabled: boolean;
  referral_reward: number;
  referral_signup_bonus: number;
};

/** What the database starts with; also used before it is reachable. */
export const DEFAULT_PRICING: PricingSettings = {
  signup_credits: 30,
  discount_until: null,
  referral_enabled: false,
  referral_reward: 30,
  referral_signup_bonus: 0,
};

export async function getPricingSettings(): Promise<PricingSettings> {
  if (!supabaseConfigured) return DEFAULT_PRICING;
  const supabase = await createClient();
  const { data } = await supabase
    .from("pricing_settings")
    .select("signup_credits, discount_until, referral_enabled, referral_reward, referral_signup_bonus")
    .maybeSingle<PricingSettings>();
  return data ?? DEFAULT_PRICING;
}

/** Cookie holding an invite code from /r/<code> until the visitor signs in. */
export const REFERRAL_COOKIE = "ref";
