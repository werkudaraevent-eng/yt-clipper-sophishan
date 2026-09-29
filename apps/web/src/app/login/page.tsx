import Link from "next/link";
import { LogoMark } from "@/components/AppShell";
import { Icon } from "@/components/ui/Icon";
import { googleAuthEnabled, supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { signInWithEmail, signInWithGoogle } from "./actions";

/** Google's "G" in its brand colours, as its sign-in guidelines ask. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string; url?: string }>;
}) {
  const { next: nextParam, error, sent, url } = await searchParams;
  // A link pasted on the landing page comes back prefilled after sign-in.
  const next = nextParam ?? (url ? `/?url=${encodeURIComponent(url)}#create` : "/");
  const t = await getDictionary();
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-on-primary lg:flex">
        <div aria-hidden className="absolute inset-0 bg-linear-to-br from-white/10 to-black/30" />
        <Link href="/" className="relative flex items-center gap-3 text-title-l">
          <LogoMark size={36} />
          Sophishan Clipper
        </Link>
        <div className="relative flex max-w-md flex-col gap-4">
          <h2 className="text-display-s">{t.login.panelTitle}</h2>
          <p className="text-body-l opacity-90">{t.login.panelBody}</p>
        </div>
        <dl className="relative flex gap-10">
          {t.login.stats.map((s) => (
            <div key={s.label}>
              <dt className="text-headline-s">{s.value}</dt>
              <dd className="text-body-s opacity-80">{s.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col justify-center bg-surface px-4 py-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <Link href="/" className="flex items-center gap-3 text-title-l text-on-surface lg:hidden">
            <LogoMark size={36} />
            Sophishan Clipper
          </Link>
          <div>
            <h1 className="text-headline-m text-on-surface">{t.login.title}</h1>
            <p className="mt-1 text-body-m text-on-surface-variant">{t.login.subtitle}</p>
          </div>

          {!supabaseConfigured && (
            <p className="rounded-md bg-warning-container p-3 text-body-m text-on-warning-container">
              {t.login.notConfigured}
            </p>
          )}
          {error && (
            <p role="alert" className="flex gap-2 rounded-md bg-error-container p-3 text-body-m text-on-error-container">
              <Icon name="error" size={20} className="shrink-0" />
              {error}
            </p>
          )}
          {sent && (
            <p className="flex gap-2 rounded-md bg-success-container p-3 text-body-m text-on-success-container">
              <Icon name="checkCircle" size={20} className="shrink-0" />
              {t.login.sent}
            </p>
          )}

          {googleAuthEnabled && (
            <>
              <form action={signInWithGoogle}>
                <input type="hidden" name="next" value={next} />
                <button className="btn-secondary h-12 w-full" disabled={!supabaseConfigured}>
                  <GoogleMark />
                  {t.login.google}
                </button>
              </form>
              <div className="flex items-center gap-3 text-body-s text-on-surface-variant">
                <span className="h-px flex-1 bg-outline-variant" /> {t.login.or}{" "}
                <span className="h-px flex-1 bg-outline-variant" />
              </div>
            </>
          )}

          <form action={signInWithEmail} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <div>
              <div className="relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="nama@email.com"
                  className="input h-14"
                />
                <label
                  htmlFor="email"
                  className="pointer-events-none absolute -top-2 left-3 bg-surface px-1 text-body-s text-on-surface-variant"
                >
                  {t.login.email}
                </label>
              </div>
              <p className="mt-1 px-4 text-body-s text-on-surface-variant">{t.login.emailHint}</p>
            </div>
            <button className="btn-primary h-12" disabled={!supabaseConfigured}>
              {t.login.emailLink}
            </button>
          </form>
          <p className="text-center text-body-s text-on-surface-variant">
            {t.legal.agree}{" "}
            <Link href="/terms" className="text-primary underline">
              {t.legal.terms}
            </Link>{" "}
            {t.legal.and}{" "}
            <Link href="/privacy" className="text-primary underline">
              {t.legal.privacy}
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
