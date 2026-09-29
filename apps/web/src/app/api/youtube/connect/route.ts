import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { authUrl, callbackUrl, safeNext, youtubePostingEnabled } from "@/lib/youtube-upload";

/** Starts Google OAuth for the YouTube upload scope; `next` is where to return. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  if (!youtubePostingEnabled) return NextResponse.redirect(new URL(next, url));
  if (!(await currentUser())) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  }
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax" as const, maxAge: 600, path: "/" };
  jar.set("yt_oauth_state", state, opts);
  jar.set("yt_oauth_next", next, opts);
  return NextResponse.redirect(authUrl(callbackUrl(url), state));
}
