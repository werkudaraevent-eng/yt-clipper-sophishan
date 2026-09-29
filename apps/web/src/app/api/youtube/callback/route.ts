import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/session";
import { YouTubeError, callbackUrl, encryptToken, exchangeCode, safeNext } from "@/lib/youtube-upload";

/** Google sends the user back here; store the encrypted refresh token and return. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const state = jar.get("yt_oauth_state")?.value;
  const next = safeNext(jar.get("yt_oauth_next")?.value ?? null);
  jar.delete("yt_oauth_state");
  jar.delete("yt_oauth_next");

  const back = (result: string) => {
    const target = new URL(next, url);
    target.searchParams.set("youtube", result);
    return NextResponse.redirect(target);
  };

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return back("denied");
  if (!state || url.searchParams.get("state") !== state) return back("error");
  if (!(await currentUser())) return back("error");

  try {
    const { refreshToken, email } = await exchangeCode(code, callbackUrl(url));
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_youtube_connection", {
      google_email: email,
      refresh_token_enc: encryptToken(refreshToken),
    });
    if (error) throw error;
    return back("connected");
  } catch (e) {
    console.error("youtube connect failed", e);
    return back(e instanceof YouTubeError && e.code === "scope" ? "scope" : "error");
  }
}
