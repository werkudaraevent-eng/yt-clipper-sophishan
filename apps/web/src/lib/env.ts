/** True when the Supabase project is configured (it is not in CI or a bare checkout). */
export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Show "Continue with Google" only once the Google provider is enabled in Supabase. */
export const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
