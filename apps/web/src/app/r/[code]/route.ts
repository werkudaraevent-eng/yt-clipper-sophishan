import { NextResponse } from "next/server";
import { REFERRAL_COOKIE } from "@/lib/pricing";

/**
 * An invite link: remember the code until the visitor signs in (the auth
 * callback claims it), then show the landing page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const response = NextResponse.redirect(new URL("/", request.url));
  if (/^[a-z0-9]{4,32}$/i.test(code)) {
    response.cookies.set(REFERRAL_COOKIE, code.toLowerCase(), {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return response;
}
