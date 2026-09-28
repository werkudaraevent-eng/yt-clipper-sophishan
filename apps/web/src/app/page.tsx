import { AppShell } from "@/components/AppShell";
import { ProjectList } from "@/components/ProjectList";
import { Icon } from "@/components/ui/Icon";
import { supabaseConfigured } from "@/lib/env";
import { getDictionary } from "@/lib/i18n/server";
import { currentCredits, currentUser } from "@/lib/session";
import { CreateForm } from "./create-form";
import { Landing } from "./landing";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const user = await currentUser();
  const [t, credits, { url }] = await Promise.all([getDictionary(), currentCredits(user), searchParams]);
  if (!user) return <Landing />;
  return (
    <AppShell user={user} title={t.nav.home}>
      {!supabaseConfigured && (
        <p className="rounded-md bg-warning-container p-3 text-body-m text-on-warning-container">
          {t.home.previewMode}
        </p>
      )}
      <CreateForm
        disabled={!supabaseConfigured}
        credits={credits}
        initialUrl={url ?? ""}
        aside={
          <>
            <ProjectList recent={4} />
            <p className="flex gap-3 rounded-lg bg-surface-container-high p-4 text-body-m text-on-surface-variant">
              <Icon name="info" className="shrink-0" />
              {t.home.tip}
            </p>
          </>
        }
      />
    </AppShell>
  );
}
