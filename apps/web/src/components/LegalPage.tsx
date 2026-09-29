import { AppShell } from "@/components/AppShell";
import { getLocale } from "@/lib/i18n/server";
import { LEGAL } from "@/lib/legal";
import { currentUser } from "@/lib/session";

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Plain text with URLs and the contact email turned into links. */
function Rich({ text, fallback }: { text: string; fallback: string }) {
  const parts = text.replace("{contact}", CONTACT ?? fallback).split(/(https?:\/\/[^\s)]+|\S+@\S+\.[a-z]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-primary underline">
            {p}
          </a>
        ) : /^\S+@\S+\.[a-z]+$/.test(p) ? (
          <a key={i} href={`mailto:${p}`} className="text-primary underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

export async function LegalPage({ doc: key }: { doc: "privacy" | "terms" }) {
  const [user, locale] = await Promise.all([currentUser(), getLocale()]);
  const doc = LEGAL[key][locale];
  const fallback = locale === "id" ? "kami" : "us";
  const body = (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-m text-on-surface">{doc.title}</h1>
        <p className="text-body-s text-on-surface-variant">{doc.updated}</p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-2">
          <h2 className="text-title-l text-on-surface">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-body-l text-on-surface-variant">
              <Rich text={p} fallback={fallback} />
            </p>
          ))}
        </section>
      ))}
    </article>
  );
  return (
    <AppShell user={user} title={user ? doc.title : undefined}>
      {body}
    </AppShell>
  );
}
