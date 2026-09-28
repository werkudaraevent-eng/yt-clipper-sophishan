import type { ProjectStatus } from "@clipper/shared";

const STYLES: Record<ProjectStatus, string> = {
  queued: "bg-slate-200 text-slate-800",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  expired: "bg-slate-300 text-slate-600",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${STYLES[status]}`}>
      {status}
    </span>
  );
}
