import { AppShell } from "@/components/AppShell";
import { getLocale } from "@/lib/i18n/server";
import { LEGAL } from "@/lib/legal";
import { currentUser } from "@/lib/session";

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const LINK = "text-primary underline underline-offset-2 hover:decoration-2";

/** Paragraph text with `[label](url)` links and the contact email as a mailto link. */
function Rich({ text, fallback }: { text: string; fallback: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\{contact\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          return (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer" className={LINK}>
              {link[1]}
            </a>
          );
        }
        if (p === "{contact}") {
          return CONTACT ? (
            <a key={i} href={`mailto:${CONTACT}`} className={LINK}>
              {CONTACT}
            </a>
          ) : (
            fallback
          );
        }
        return p;
      })}
    </>
  );
}

/**
 * Privacy policy and terms as a single reading column: body-large text kept
 * to roughly 60–75 characters a line, headings on the M3 type scale, and the
 * window margins of the page it sits in (app shell when signed in, the
 * public top bar otherwise).
 */
export async function LegalPage({ doc: key }: { doc: "privacy" | "terms" }) {
  const [user, locale] = await Promise.all([currentUser(), getLocale()]);
  const doc = LEGAL[key][locale];
  const fallback = locale === "id" ? "kami" : "us";
  const body = (
    <article className="flex w-full max-w-[60ch] flex-col gap-8">
      <header className="flex flex-col gap-2">
        {/* Signed in, the top app bar already carries the title. */}
        {!user && <h1 className="text-headline-m text-on-surface">{doc.title}</h1>}
        <p className="text-body-m text-on-surface-variant">{doc.updated}</p>
      </header>
      {doc.sections.map((s, n) => (
        <section key={s.heading} aria-labelledby={`${key}-${n}`} className="flex flex-col gap-3">
          <h2 id={`${key}-${n}`} className="text-title-l text-on-surface">
            {s.heading}
          </h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-body-l text-on-surface-variant">
              <Rich text={p} fallback={fallback} />
            </p>
          ))}
        </section>
      ))}
    </article>
  );
  return user ? (
    <AppShell user={user} title={doc.title}>
      {body}
    </AppShell>
  ) : (
    <AppShell user={null}>
      <main className="mx-auto flex max-w-6xl px-4 pt-6 pb-16 sm:px-8">{body}</main>
    </AppShell>
  );
}
