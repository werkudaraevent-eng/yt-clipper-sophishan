import { AppShell } from "@/components/AppShell";
import { MarkChangelogSeen } from "@/components/MarkChangelogSeen";
import { LATEST_RELEASE, RELEASES, releaseDate, type ChangeKind } from "@/lib/changelog";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentUser } from "@/lib/session";

export async function generateMetadata() {
  const t = await getDictionary();
  return { title: `${t.changelog.title} · Sophishan Clipper` };
}

const CHIP: Record<ChangeKind, string> = {
  new: "bg-primary-container text-on-primary-container",
  improved: "bg-secondary-container text-on-secondary-container",
  fixed: "bg-surface-container-highest text-on-surface-variant",
};

/**
 * Release notes: one dated card per release, newest first. On wide screens the
 * date sits in its own column and the list stops at 1000 px so descriptions
 * stay short enough to read in one sweep.
 */
export default async function ChangelogPage() {
  const [user, t, locale] = await Promise.all([currentUser(), getDictionary(), getLocale()]);

  const body = (
    <div className="flex flex-col gap-6 md:gap-8">
      <MarkChangelogSeen latest={LATEST_RELEASE} />
      <header className="flex flex-col gap-1">
        <h2 className="text-headline-s text-on-surface">{t.changelog.heading}</h2>
        <p className="text-body-m text-on-surface-variant">{t.changelog.intro}</p>
      </header>
      <div className="flex w-full max-w-[1000px] flex-col gap-6 md:gap-8">
        {RELEASES.map((r, n) => (
          <section key={r.date} aria-labelledby={`release-${r.date}`} className="flex flex-col gap-2 md:flex-row md:gap-6">
            <div className="flex items-center gap-2 md:w-40 md:shrink-0 md:flex-col md:items-start md:pt-6">
              <time dateTime={r.date} className="text-title-s text-on-surface">
                {releaseDate(r.date, locale)}
              </time>
              {n === 0 && (
                <span className="rounded-[6px] bg-tertiary-container px-2 py-0.5 text-label-m text-on-tertiary-container">
                  {t.changelog.latest}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg bg-surface-container-low p-4 md:gap-5 md:p-6">
              <h3 id={`release-${r.date}`} className="text-title-m text-on-surface md:text-title-l">
                {r.title[locale]}
              </h3>
              <ul className="flex flex-col gap-4">
                {r.items.map((item) => (
                  <li
                    key={item.title.en}
                    className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 md:grid-cols-[88px_1fr] md:items-start md:gap-x-4 md:gap-y-0.5"
                  >
                    <span className={`justify-self-start rounded-sm px-2.5 py-1 text-label-m ${CHIP[item.kind]}`}>
                      {t.changelog.kinds[item.kind]}
                    </span>
                    <h4 className="text-title-s text-on-surface md:text-title-m">{item.title[locale]}</h4>
                    <p className="col-span-2 text-body-m text-on-surface-variant md:col-span-1 md:col-start-2">
                      {item.body[locale]}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  return user ? (
    <AppShell user={user} title={t.changelog.title} onChangelog>
      {body}
    </AppShell>
  ) : (
    <AppShell user={null}>
      <main className="mx-auto flex max-w-6xl flex-col px-4 pt-6 pb-16 sm:px-8">{body}</main>
    </AppShell>
  );
}
