"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, isTheme } from "./theme";

/** Stores an explicit light/dark choice; without it the OS setting applies. */
export async function setTheme(formData: FormData) {
  const theme = formData.get("theme");
  if (!isTheme(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
