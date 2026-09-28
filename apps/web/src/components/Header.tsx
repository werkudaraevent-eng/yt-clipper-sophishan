import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { LOCALES } from "@/lib/i18n/dictionaries";
import { setLocale } from "@/lib/i18n/actions";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function Header({ user }: { user: User | null }) {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
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
