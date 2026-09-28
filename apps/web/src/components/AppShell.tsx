import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { LOCALES } from "@/lib/i18n/dictionaries";
import { setLocale } from "@/lib/i18n/actions";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { currentCredits, currentIsAdmin } from "@/lib/session";
import { NavDestinations, type Destination } from "./NavDestinations";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "./ui/Icon";

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md bg-linear-to-br from-primary-container to-tertiary-container text-white"
      style={{ width: size, height: size }}
    >
      <Icon name="cut" size={Math.round(size * 0.55)} />
    </span>
  );
}

async function LanguageSwitch() {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  return (
    <form action={setLocale} aria-label={t.header.language} className="flex items-center">
      <Icon name="language" size={20} className="mr-1 text-on-surface-variant" />
      {LOCALES.map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          aria-pressed={l === locale}
          className={`state-layer focus-ring rounded-sm px-2 py-1 text-label-l uppercase ${
            l === locale ? "text-on-surface" : "text-on-surface-variant"
          }`}
        >
          {l}
        </button>
      ))}
    </form>
  );
}

/**
 * App frame following M3 adaptive layout: a navigation rail from the medium
 * breakpoint up, a bottom navigation bar on compact screens, and a small top
 * app bar with the page title. Signed-out visitors get a simple top bar.
 */
export async function AppShell({
  user,
  title,
  backHref,
  children,
}: {
  user: User | null;
  title?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  const t = await getDictionary();

  if (!user) {
    return (
      <>
        <header className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 text-title-l text-on-surface">
            <LogoMark size={36} />
            <span className="hidden sm:inline">Sophishan Clipper</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <ThemeToggle />
            <Link href="/login" className="btn-primary">
              {t.header.signIn}
            </Link>
          </div>
        </header>
        {children}
      </>
    );
  }

  const [credits, isAdmin] = await Promise.all([currentCredits(user), currentIsAdmin(user)]);
  const items: Destination[] = [
    { href: "/", label: t.nav.home, icon: "home", activeIcon: "homeFill" },
    { href: "/projects", label: t.nav.projects, icon: "videoLibrary", activeIcon: "videoLibraryFill" },
    { href: "/credits", label: t.nav.credits, icon: "toll", activeIcon: "tollFill" },
  ];
  if (isAdmin) items.push({ href: "/admin", label: t.nav.admin, icon: "admin", activeIcon: "adminFill" });
  const initials = (user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-screen w-24 shrink-0 flex-col items-center gap-3 bg-surface-container pt-5 pb-6 md:flex"
      >
        <Link href="/" aria-label="Sophishan Clipper">
          <LogoMark />
        </Link>
        <Link
          href="/#create"
          title={t.nav.newProject}
          aria-label={t.nav.newProject}
          className="state-layer focus-ring mt-3 mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-primary-container text-on-primary-container shadow-elev-3"
        >
          <Icon name="add" />
        </Link>
        <NavDestinations items={items} variant="rail" />
        <div className="mt-auto flex flex-col items-center gap-2">
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button
              title={t.header.signOut}
              aria-label={t.header.signOut}
              className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
            >
              <Icon name="logout" />
            </button>
          </form>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-2 bg-surface px-4 sm:px-6 lg:px-12">
          {backHref ? (
            <Link
              href={backHref}
              aria-label={t.nav.back}
              className="state-layer focus-ring -ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-on-surface"
            >
              <Icon name="arrowBack" />
            </Link>
          ) : (
            <Link href="/" className="md:hidden" aria-label="Sophishan Clipper">
              <LogoMark size={32} />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-title-l text-on-surface">{title}</h1>
          {credits != null && (
            <Link
              href="/credits"
              className="state-layer focus-ring flex h-8 items-center gap-2 rounded-sm border border-outline-variant pr-4 pl-2 text-label-l text-on-surface"
            >
              <Icon name="tollFill" size={18} className="text-primary" />
              {credits}
              <span className="hidden sm:inline">{t.header.credits}</span>
            </Link>
          )}
          <div className="hidden sm:block">
            <LanguageSwitch />
          </div>
          <div className="flex md:hidden">
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button
                title={t.header.signOut}
                aria-label={t.header.signOut}
                className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
              >
                <Icon name="logout" />
              </button>
            </form>
          </div>
          <span
            title={user.email}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tertiary-container text-label-l text-on-tertiary-container"
          >
            {initials}
          </span>
        </header>
        {/* One body region for every page: M3 margins (16 / 24 / 48 dp), content
            starts beside the rail and grows with the window up to a cap. */}
        <main className="flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-6 lg:px-12">
          {children}
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 bg-surface-container md:hidden">
        <NavDestinations items={items} variant="bar" />
      </nav>
    </div>
  );
}
