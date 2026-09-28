"use client";

import { useDictionary } from "@/lib/i18n/client";
import { setTheme } from "@/lib/theme-actions";
import { Icon } from "./ui/Icon";

function effectiveTheme(): "light" | "dark" {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Flips between light and dark right away, then remembers it in a cookie. */
export function ThemeToggle() {
  const t = useDictionary();
  return (
    <button
      type="button"
      title={t.nav.theme}
      aria-label={t.nav.theme}
      className="state-layer focus-ring flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
      onClick={() => {
        const next = effectiveTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        const form = new FormData();
        form.set("theme", next);
        void setTheme(form);
      }}
    >
      <Icon name="darkMode" className="dark:hidden" />
      <Icon name="lightMode" className="hidden dark:block" />
    </button>
  );
}
