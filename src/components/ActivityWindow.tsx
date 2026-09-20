"use client";

import { useState, type ReactNode } from "react";
import { elapsedOf, formatElapsed } from "@/lib/activity/log";
import { useActivities, useNow } from "@/lib/activity/hooks";

export type ActivityStatus = "idle" | "pending" | "done" | "error";

const STATUS_STYLE: Record<ActivityStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-muted", label: "idle" },
  pending: { dot: "bg-amber-600 animate-pulse-dot", label: "running…" },
  done: { dot: "bg-emerald-600", label: "done" },
  error: { dot: "bg-rose-600", label: "error" },
};

/** The live timer for one activity-log record: counts up from zero while it runs, then shows the measured time. */
function ElapsedLabel({ activityId }: { activityId: number }) {
  const record = useActivities().find((r) => r.id === activityId);
  const now = useNow(record?.status === "pending");
  if (!record || record.simulated) return null;
  return <span className="tabular-nums text-muted">{formatElapsed(elapsedOf(record, now))}</span>;
}

/**
 * A self-contained, independently collapsible panel for one backend's
 * activity. Two of these render side by side in the Compare tab, each
 * driven by its own network request (see page.tsx) — the status dot and
 * body update the moment THIS window's own fetch resolves, with no
 * dependency on the other window's timing. `activityId` is the activity-log record behind this window's timer; a new
 * check passes a new id, so the timer starts again from zero every time.
 */
export function ActivityWindow({
  title,
  subtitle,
  status,
  activityId = null,
  accent,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  subtitle: string;
  status: ActivityStatus;
  activityId?: number | null;
  accent: "deep" | "violet";
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const s = STATUS_STYLE[status];
  const accentBg = accent === "deep" ? "bg-deep" : "bg-violet-500";

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accentBg}`} />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-foreground">{title}</p>
            <p className="truncate text-sm text-muted" title={subtitle}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-sm font-semibold text-secondary">
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.label}
            {activityId != null && status !== "idle" && <ElapsedLabel activityId={activityId} />}
          </span>
          <span className={`text-secondary transition-transform ${collapsed ? "" : "rotate-180"}`}>⌄</span>
        </div>
      </button>
      {!collapsed && <div className="animate-in border-t border-border p-4">{children}</div>}
    </div>
  );
}
