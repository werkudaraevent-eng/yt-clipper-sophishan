import { AppShell } from "@/components/AppShell";
import { ProjectList } from "@/components/ProjectList";
import { supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { currentCredits, currentUser } from "@/lib/session";
import { CreateForm } from "./create-form";

export default async function Home() {
  const user = await currentUser();
  const [t, credits] = await Promise.all([getDictionary(), currentCredits(user)]);
  return (
    <AppShell user={user} title={t.nav.home}>
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-6 sm:px-8">
        {!supabaseConfigured && (
          <p className="mx-auto w-full max-w-lg rounded-md bg-warning-container p-3 text-body-m text-on-warning-container">
            {t.home.previewMode}
          </p>
        )}
        <section
          id="create"
          className="flex flex-col items-center gap-6 rounded-xl bg-surface-container-low px-4 py-10 text-center sm:px-10"
        >
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 className="text-headline-m text-on-surface sm:text-display-s">{t.home.heroTitle}</h2>
            <p className="text-body-l text-on-surface-variant">{t.home.heroSubtitle}</p>
          </div>
          <div className="w-full max-w-lg text-left">
            <CreateForm disabled={!supabaseConfigured} credits={credits} />
          </div>
        </section>
        {user ? (
          <ProjectList recent={4} />
        ) : (
          <section className="flex flex-col gap-4">
            <ul className="grid gap-4 sm:grid-cols-3">
              {t.home.features.map((f) => (
                <li key={f.title} className="card">
                  <h3 className="text-title-m">{f.title}</h3>
                  <p className="mt-1 text-body-m text-on-surface-variant">{f.body}</p>
                </li>
              ))}
            </ul>
            <p className="text-center text-body-m text-on-surface-variant">{t.home.freeNote}</p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
