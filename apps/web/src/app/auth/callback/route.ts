import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REFERRAL_COOKIE } from "@/lib/pricing";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));
  const supabase = await createClient();

  // Email links carry a token hash (see supabase/templates). Unlike the PKCE
  // `code`, it does not need a cookie from the browser that asked for the
  // link, so it still works when the mail is opened in another browser.
  let signedIn = false;
  if (tokenHash && type && EMAIL_OTP_TYPES.has(type)) {
    signedIn = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    signedIn = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  if (signedIn) {
    await claimReferral(supabase);
    return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=Sign-in%20link%20expired`);
}

/**
 * Link a new account to the friend whose invite link brought it here. The
 * database only accepts this for an account made in the last day, once.
 */
async function claimReferral(supabase: Awaited<ReturnType<typeof createClient>>) {
  const store = await cookies();
  const ref = store.get(REFERRAL_COOKIE)?.value;
  if (!ref) return;
  try {
    await supabase.rpc("claim_referral", { p_code: ref });
  } catch (e) {
    console.error("claim_referral", e);
  }
  store.delete(REFERRAL_COOKIE);
}
