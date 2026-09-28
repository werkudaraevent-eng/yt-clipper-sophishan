"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./ui/Icon";

export type Destination = {
  href: string;
  label: string;
  icon: IconName;
  activeIcon: IconName;
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * M3 navigation destinations. "rail" is the vertical navigation rail for
 * medium and expanded windows; "bar" is the bottom navigation bar for compact.
 */
export function NavDestinations({
  items,
  variant,
}: {
  items: Destination[];
  variant: "rail" | "bar";
}) {
  const pathname = usePathname();
  // Project pages belong to the Projects destination.
  const path = pathname.startsWith("/projects/") ? "/projects" : pathname;
  return (
    <ul className={variant === "rail" ? "flex flex-col items-center gap-3" : "flex h-20 items-stretch justify-around"}>
      {items.map((item) => {
        const active = isActive(path, item.href);
        return (
          <li key={item.href} className={variant === "bar" ? "flex flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group focus-ring flex flex-1 flex-col items-center gap-1 rounded-md text-label-m ${
                variant === "rail" ? "w-20" : "justify-center pt-3 pb-4"
              } ${active ? "text-on-surface" : "text-on-surface-variant"}`}
            >
              <span
                className={`state-layer flex h-8 items-center justify-center rounded-full ${
                  variant === "rail" ? "w-14" : "w-16"
                } ${active ? "bg-secondary-container text-on-secondary-container" : ""}`}
              >
                <Icon name={active ? item.activeIcon : item.icon} />
              </span>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
