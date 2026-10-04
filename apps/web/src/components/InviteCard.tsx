"use client";

import { useState } from "react";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { Icon } from "./ui/Icon";

export type Invite = {
  code: string;
  reward: number;
  bonus: number;
  invited: number;
  bought: number;
  earned: number;
};

/** The user's invite link on /credits, with how it has done so far. */
export function InviteCard({ invite, link, t }: { invite: Invite; link: string; t: Dictionary }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is still on screen to copy by hand.
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-primary-container p-5 text-on-primary-container">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
          <Icon name="share" size={20} />
        </span>
        <h2 className="text-title-m">{fill(t.invite.title, { n: invite.reward })}</h2>
      </div>
      <p className="text-body-s">
        {fill(t.invite.body, { reward: invite.reward })}
        {invite.bonus > 0 && ` ${fill(t.invite.bonus, { bonus: invite.bonus })}`}
      </p>
      <div className="flex items-center gap-2 rounded-full bg-surface-container-lowest py-1 pr-1 pl-4">
        <Icon name="link" size={18} className="shrink-0 text-on-surface-variant" />
        <span className="sr-only">{t.invite.link}</span>
        <span className="min-w-0 flex-1 truncate text-body-m text-on-surface">{link.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={copy} className="btn-primary shrink-0 px-4">
          {copied && <Icon name="check" size={18} />}
          {copied ? t.invite.copied : t.invite.copy}
        </button>
      </div>
      <p className="text-body-s">
        {fill(t.invite.stats, { invited: invite.invited, bought: invite.bought, earned: invite.earned })}
      </p>
    </section>
  );
}
