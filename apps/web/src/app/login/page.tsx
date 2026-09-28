import { supabaseConfigured } from "@/lib/env";
import { signInWithEmail, signInWithGoogle } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string }>;
}) {
  const { next = "/", error, sent } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Turn long videos into shorts in minutes.</p>
      </div>

      {!supabaseConfigured && (
        <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-900">
          Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      )}
      {error && <p className="rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</p>}
      {sent && (
        <p className="rounded-md bg-green-100 p-3 text-sm text-green-800">
          Check your inbox for a sign-in link.
        </p>
      )}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button className="btn-secondary w-full" disabled={!supabaseConfigured}>
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      <form action={signInWithEmail} className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input id="email" name="email" type="email" required className="input" />
        <button className="btn-primary" disabled={!supabaseConfigured}>
          Email me a sign-in link
        </button>
      </form>
    </main>
  );
}
