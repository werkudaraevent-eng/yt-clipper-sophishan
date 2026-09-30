import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ClipCard, SampleMedia } from "@/components/ClipCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getDictionary } from "@/lib/i18n/server";

// Fixed stand-in "video" colours for the sample clips; they are not theme roles.
const SAMPLE_GRADIENTS = [
  "bg-linear-to-b from-[#1f3f3a] to-[#3f8f7a]",
  "bg-linear-to-b from-[#2b2340] to-[#b0573b]",
  "bg-linear-to-b from-[#3a1f2e] to-[#a8466f]",
];
const STEP_ICONS: IconName[] = ["link", "wand", "download"];

/** Signed-out home: what the product does, sample results, and a way in. */
export async function Landing() {
  const t = await getDictionary();
  return (
    <AppShell user={null}>
      <main>
        <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pt-10 pb-16 text-center sm:px-8 sm:pt-16">
          <span className="inline-flex min-h-8 items-center gap-2 rounded-sm bg-secondary-container px-3 py-1 text-label-l text-on-secondary-container">
            <Icon name="wand" size={18} />
            {t.landing.badge}
          </span>
          <h1 className="max-w-4xl text-display-s text-on-surface sm:text-display-l">
            {t.landing.titleA}
            <br />
            <span className="text-primary">{t.landing.titleB}</span>
          </h1>
          <p className="max-w-2xl text-body-l text-on-surface-variant">{t.home.heroSubtitle}</p>

          <form action="/login" className="w-full max-w-2xl">
            <div className="flex flex-col gap-3 sm:relative">
              <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-4 text-left focus-within:ring-2 focus-within:ring-primary sm:pr-40">
                <Icon name="link" className="shrink-0 text-on-surface-variant" />
                <span className="sr-only">{t.create.url}</span>
                <input
                  name="url"
                  type="url"
                  placeholder="https://youtube.com/watch?v=…"
                  className="min-w-0 flex-1 bg-transparent text-body-l text-on-surface outline-none placeholder:text-on-surface-variant"
                />
              </label>
              <button className="btn-primary h-12 sm:absolute sm:top-1 sm:right-1">
                <Icon name="wand" size={20} />
                {t.create.submit}
              </button>
            </div>
            <p className="mt-3 text-body-s text-on-surface-variant">{t.landing.signInNote}</p>
          </form>

          <ul className="mt-6 grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
            {t.landing.samples.map((s, i) => {
              // Same height and top edge for every card; the strongest sample in
              // the middle stands out through elevation only.
              const featured = i === 1;
              return (
                <li
                  key={s.title}
                  className={`flex text-left ${i === 2 ? "hidden sm:flex" : ""}`}
                >
                  <ClipCard
                    className={`w-full ${featured ? "shadow-elev-3" : "shadow-elev-1"}`}
                    media={<SampleMedia gradient={SAMPLE_GRADIENTS[i]} caption={s.caption as [string, string]} />}
                    score={s.score}
                    length={s.duration}
                    title={s.title}
                    hook={s.hook}
                    range={s.range}
                    downloadHref="/login"
                    downloadLabel={t.project.download}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="bg-surface-container-low px-4 py-16 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            <h2 className="text-center text-headline-m text-on-surface">{t.landing.stepsTitle}</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {t.landing.steps.map((step, i) => (
                <li key={step.title} className="flex flex-col gap-3 rounded-lg bg-surface-container-lowest p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-on-primary">
                    <Icon name={STEP_ICONS[i]} size={22} />
                  </span>
                  <h3 className="text-title-l text-on-surface">{step.title}</h3>
                  <p className="text-body-m text-on-surface-variant">{step.body}</p>
                </li>
              ))}
            </ol>
            <p className="text-center text-body-m text-on-surface-variant">{t.home.freeNote}</p>
          </div>
        </section>

        <footer className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-body-s text-on-surface-variant sm:px-8">
          <span>© 2026 Sophishan</span>
          <Link href="/privacy" className="hover:text-on-surface hover:underline">
            {t.legal.privacy}
          </Link>
          <Link href="/terms" className="hover:text-on-surface hover:underline">
            {t.legal.terms}
          </Link>
          <Link href="/changelog" className="hover:text-on-surface hover:underline">
            {t.changelog.title}
          </Link>
        </footer>
      </main>
    </AppShell>
  );
}
