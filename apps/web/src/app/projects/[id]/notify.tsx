"use client";

import { useEffect, useState, useTransition } from "react";
import { Toggle } from "@/components/controls";
import { Icon } from "@/components/ui/Icon";
import { fill } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/client";
import { setNotifyEmail } from "@/lib/notify-actions";

type Permission = NotificationPermission | "unsupported";

function permission(): Permission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Shows a system notification if the visitor allowed it and is looking at another tab. */
export function notifyBrowser(title: string, body: string) {
  if (permission() !== "granted" || !document.hidden) return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

/** "Kabari saya saat klip siap" on the progress card (Figma N1 / N1m). */
export function NotifyBox({ initial, email }: { initial: boolean; email: string | null }) {
  const t = useDictionary().notify;
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();
  const [browser, setBrowser] = useState<Permission>("default");
  useEffect(() => setBrowser(permission()), []);

  const change = (value: boolean) => {
    setOn(value);
    startTransition(() => setNotifyEmail(value));
  };
  const askBrowser = async () => setBrowser(await Notification.requestPermission());

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-high p-4">
      <div className="flex items-center gap-4">
        <Icon name="campaign" className="shrink-0 text-on-surface" />
        <div className="min-w-0 flex-1">
          <Toggle
            checked={on}
            onChange={change}
            label={t.title}
            hint={
              email ? (
                <span className="font-normal sm:text-body-m">
                  <span className="sm:hidden">{fill(t.hintShort, { email })}</span>
                  <span className="hidden sm:inline">{fill(t.hint, { email })}</span>
                </span>
              ) : undefined
            }
          />
        </div>
      </div>
      {browser === "default" && (
        <button
          type="button"
          onClick={askBrowser}
          className="state-layer focus-ring flex h-10 items-center gap-2 self-start rounded-full px-3 text-left text-label-l text-primary sm:ml-7"
        >
          <Icon name="add" size={18} />
          {t.browser}
        </button>
      )}
      {browser === "granted" && (
        <p className="flex items-center gap-2 px-3 py-2 text-label-l text-on-surface-variant sm:ml-7">
          <Icon name="check" size={18} />
          {t.browserOn}
        </p>
      )}
    </div>
  );
}
