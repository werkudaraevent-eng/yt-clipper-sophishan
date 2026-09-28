"use client";

import type { ProjectStatus } from "@clipper/shared";
import { useDictionary } from "@/lib/i18n/client";
import { Icon, type IconName } from "./ui/Icon";

// Status label on M3 container roles (not an M3 component; built on its tokens).
const STYLES: Record<ProjectStatus, [string, IconName]> = {
  queued: ["bg-surface-container-highest text-on-surface-variant", "hourglass"],
  processing: ["bg-secondary-container text-on-secondary-container", "refresh"],
  ready: ["bg-success-container text-on-success-container", "checkCircle"],
  failed: ["bg-error-container text-on-error-container", "error"],
  expired: ["bg-surface-container-highest text-on-surface-variant", "schedule"],
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const t = useDictionary();
  const [style, icon] = STYLES[status];
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-sm pr-2 pl-1.5 text-label-m ${style}`}>
      <Icon name={icon} size={16} className={status === "processing" ? "animate-spin" : undefined} />
      {t.status[status]}
    </span>
  );
}
