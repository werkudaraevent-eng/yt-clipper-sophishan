import type { Metadata } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return { title: "Sophishan Clipper", description: t.meta.description };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, jar] = await Promise.all([getLocale(), cookies()]);
  const theme = jar.get(THEME_COOKIE)?.value;
  return (
    <html lang={locale} data-theme={isTheme(theme) ? theme : undefined}>
      <body className="antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
