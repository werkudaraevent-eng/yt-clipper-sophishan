import { googleAuthEnabled, supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { signInWithEmail, signInWithGoogle } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string }>;
}) {
  const { next = "/", error, sent } = await searchParams;
  const t = await getDictionary();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-bold">{t.login.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.login.subtitle}</p>
      </div>

      {!supabaseConfigured && (
        <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-900">
          {t.login.notConfigured}
        </p>
      )}
      {error && <p className="rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</p>}
      {sent && (
        <p className="rounded-md bg-green-100 p-3 text-sm text-green-800">
          {t.login.sent}
        </p>
      )}

      {googleAuthEnabled && (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <button className="btn-secondary w-full" disabled={!supabaseConfigured}>
              {t.login.google}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" /> {t.login.or} <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form action={signInWithEmail} className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="text-sm font-medium">
          {t.login.email}
        </label>
        <input id="email" name="email" type="email" required className="input" />
        <button className="btn-primary" disabled={!supabaseConfigured}>
          {t.login.emailLink}
        </button>
      </form>
    </main>
  );
}
