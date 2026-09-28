import Link from "next/link";
import type { User } from "@supabase/supabase-js";

export function Header({ user }: { user: User | null }) {
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-bold">
          Sophishan Clipper
        </Link>
        {user ? (
          <form action="/auth/signout" method="post" className="flex items-center gap-3">
            <span
              title={user.email}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-900"
            >
              {initials}
            </span>
            <button className="text-sm text-muted hover:text-foreground">Sign out</button>
          </form>
        ) : (
          <Link href="/login" className="btn-primary">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
