import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { fill } from "@/lib/i18n/dictionaries";
import { getDictionary } from "@/lib/i18n/server";
import { currentIsAdmin, currentUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { adjustCredits } from "./actions";

type FoundUser = {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  credits_remaining: number;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; balance?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await currentIsAdmin(user))) notFound();

  const { email = "", balance, error } = await searchParams;
  const t = await getDictionary();
  const errors = t.admin.errors;

  let found: FoundUser | null = null;
  if (email) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_find_user", { target_email: email });
    found = (data as FoundUser[] | null)?.[0] ?? null;
  }

  return (
    <>
      <Header user={user} />
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-bold">{t.admin.title}</h1>

        <form className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t.admin.searchLabel}
          </label>
          <div className="flex gap-2">
            <input id="email" name="email" type="email" required defaultValue={email} className="input flex-1" />
            <button className="btn-secondary">{t.admin.search}</button>
          </div>
        </form>

        {balance && (
          <p className="rounded-md bg-green-100 p-3 text-sm text-green-800">
            {fill(t.admin.done, { balance })}
          </p>
        )}
        {error && (
          <p className="rounded-md bg-red-100 p-3 text-sm text-red-800">
            {errors[error as keyof typeof errors] ?? errors.failed}
          </p>
        )}

        {email && !found && <p className="text-sm text-muted">{t.admin.notFound}</p>}

        {found && (
          <section className="card flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Email</dt>
              <dd className="break-all">{found.email}</dd>
              <dt className="text-muted">{t.admin.name}</dt>
              <dd>{found.display_name ?? "-"}</dd>
              <dt className="text-muted">{t.admin.plan}</dt>
              <dd>{found.plan}</dd>
              <dt className="text-muted">{t.admin.balance}</dt>
              <dd className="font-semibold">{found.credits_remaining}</dd>
            </dl>
            <form action={adjustCredits} className="flex flex-col gap-2">
              <input type="hidden" name="email" value={found.email} />
              <input type="hidden" name="userId" value={found.id} />
              <label htmlFor="amount" className="text-sm font-medium">
                {t.admin.amount}
              </label>
              <input id="amount" name="amount" type="number" step={1} required className="input" />
              <label htmlFor="note" className="text-sm font-medium">
                {t.admin.note}
              </label>
              <input id="note" name="note" maxLength={200} placeholder={t.admin.notePlaceholder} className="input" />
              <button className="btn-primary">{t.admin.apply}</button>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
