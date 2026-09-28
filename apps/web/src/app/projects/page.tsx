import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProjectList } from "@/components/ProjectList";
import { getDictionary } from "@/lib/i18n/server";
import { currentUser } from "@/lib/session";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/projects");
  const [params, t] = await Promise.all([searchParams, getDictionary()]);
  return (
    <AppShell user={user} title={t.nav.projects}>
      <ProjectList {...params} />
    </AppShell>
  );
}
