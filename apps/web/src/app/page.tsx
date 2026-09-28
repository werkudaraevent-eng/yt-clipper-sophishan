import { Header } from "@/components/Header";
import { ProjectList } from "@/components/ProjectList";
import { supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { currentCredits, currentUser } from "@/lib/session";
import { CreateForm } from "./create-form";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  const [t, credits] = await Promise.all([getDictionary(), currentCredits(user)]);
  return (
    <>
      <Header user={user} />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
        {!supabaseConfigured && (
          <p className="mx-auto w-full max-w-lg rounded-md bg-amber-100 p-3 text-sm text-amber-900">
            {t.home.previewMode}
          </p>
        )}
        {!user && (
          <section className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.home.heroTitle}</h1>
            <p className="text-muted">{t.home.heroSubtitle}</p>
          </section>
        )}
        <div className="mx-auto w-full max-w-lg">
          <CreateForm disabled={!supabaseConfigured} credits={credits} />
        </div>
        {user ? (
          <ProjectList {...params} />
        ) : (
          <section className="flex flex-col gap-4">
            <ul className="grid gap-4 sm:grid-cols-3">
              {t.home.features.map((f) => (
                <li key={f.title} className="card">
                  <h2 className="font-semibold">{f.title}</h2>
                  <p className="mt-1 text-sm text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
            <p className="text-center text-sm text-muted">{t.home.freeNote}</p>
          </section>
        )}
      </main>
    </>
  );
}
