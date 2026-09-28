import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { LOCALES } from "@/lib/i18n/dictionaries";
import { setLocale } from "@/lib/i18n/actions";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentCredits, currentIsAdmin } from "@/lib/session";

export async function Header({ user }: { user: User | null }) {
  const [t, locale, credits, isAdmin] = await Promise.all([
    getDictionary(),
    getLocale(),
    currentCredits(user),
    currentIsAdmin(user),
  ]);
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-bold">
          Sophishan Clipper
        </Link>
        <div className="flex items-center gap-3">
          <form action={setLocale} aria-label={t.header.language} className="flex text-xs">
            {LOCALES.map((l) => (
              <button
                key={l}
                name="locale"
                value={l}
                aria-pressed={l === locale}
                className={`px-1.5 py-1 uppercase ${
                  l === locale ? "font-bold text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </form>
          {user ? (
            <form action="/auth/signout" method="post" className="flex items-center gap-3">
              {isAdmin && (
                <Link href="/admin" className="text-sm text-muted hover:text-foreground">
                  {t.admin.link}
                </Link>
              )}
              {credits != null && (
                <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                  {credits} {t.header.credits}
                </span>
              )}
              <span
                title={user.email}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-900"
              >
                {initials}
              </span>
              <button className="text-sm text-muted hover:text-foreground">
                {t.header.signOut}
              </button>
            </form>
          ) : (
            <Link href="/login" className="btn-primary">
              {t.header.signIn}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
