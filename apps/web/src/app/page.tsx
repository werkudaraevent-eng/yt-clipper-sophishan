import { Header } from "@/components/Header";
import { ProjectList } from "@/components/ProjectList";
import { supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { currentUser } from "@/lib/session";
import { CreateForm } from "./create-form";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  const t = await getDictionary();
  return (
    <>
      <Header user={user} />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
        {!supabaseConfigured && (
          <p className="mx-auto w-full max-w-lg rounded-md bg-amber-100 p-3 text-sm text-amber-900">
            {t.home.previewMode}
          </p>
        )}
        <div className="mx-auto w-full max-w-lg">
          <CreateForm disabled={!supabaseConfigured} />
        </div>
        {user && <ProjectList {...params} />}
      </main>
    </>
  );
}
