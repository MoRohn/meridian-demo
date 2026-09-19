"use client";

import type { ActivityStatus } from "./ActivityWindow";
import { formatElapsed, useElapsedTimer } from "@/lib/useElapsedTimer";

export interface BackendActivity {
  status: ActivityStatus;
  elapsedMs: number | null;
}

function TimerPill({
  name,
  active,
  activity,
  idleLabel,
  activeText,
  inactiveText,
}: {
  name: string;
  /** Whether this backend is "on" at all right now (live model / configured) — drives the dot color. */
  active: boolean;
  activity: BackendActivity;
  idleLabel: string;
  activeText: string;
  inactiveText: string;
}) {
  const elapsed = useElapsedTimer(activity.status, activity.elapsedMs);

  let text = `${name} · ${idleLabel}`;
  if (activity.status === "pending" && elapsed != null) text = `${name} · ${formatElapsed(elapsed)}…`;
  else if (activity.status === "done" && elapsed != null) text = `${name} · done in ${formatElapsed(elapsed)}`;
  else if (activity.status === "error") text = `${name} · error${elapsed != null ? ` (${formatElapsed(elapsed)})` : ""}`;

  const dotColor =
    activity.status === "pending" ? "bg-amber-500 animate-pulse-dot" : active ? "bg-deep" : "bg-muted";

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium tabular-nums transition-colors ${
        active || activity.status !== "idle"
          ? "border-deep/15 bg-deep/[0.06] text-deep"
          : "border-border-strong bg-surface text-muted"
      }`}
      title={active ? activeText : inactiveText}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
      {text}
    </div>
  );
}

export function AppHeader({
  typesafeLive,
  typesafeActivity,
  openaiConfigured,
  openaiActivity,
  onOpenSettings,
}: {
  typesafeLive: boolean;
  typesafeActivity: BackendActivity;
  openaiConfigured: boolean;
  openaiActivity: BackendActivity;
  onOpenSettings: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 300 260" className="h-9 w-10 shrink-0 text-deep" fill="currentColor" aria-label="Meridian">
          {/* Left outer leg — a vertical stroke anchored near the left edge. */}
          <path d="M 65,15 C 35,92 35,158 65,235 C 95,158 95,92 65,15 Z" />
          {/* Left arm of the middle V. */}
          <path d="M 115,70 C 93,119 116,161 150,210 C 172,161 137,119 115,70 Z" />
          {/* Right arm of the middle V. */}
          <path d="M 185,70 C 207,119 184,161 150,210 C 128,161 163,119 185,70 Z" />
          {/* Right outer leg — mirrors the left. */}
          <path d="M 235,15 C 265,92 265,158 235,235 C 205,158 205,92 235,15 Z" />
        </svg>
        <div className="leading-tight">
          <h1 className="font-serif text-lg font-extrabold tracking-tight text-deep">Meridian</h1>
          <p className="text-sm font-medium text-muted">AI Context Intake &amp; Contract Risk Copilot</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <TimerPill
          name="TypeSafe AI"
          active={typesafeLive}
          activity={typesafeActivity}
          idleLabel={typesafeLive ? "Live" : "demo mode"}
          activeText="Calling the live Jev model"
          inactiveText="No TYPESAFE_API_KEY — using the local heuristic mock"
        />
        <TimerPill
          name="OpenAI"
          active={openaiConfigured}
          activity={openaiActivity}
          idleLabel={openaiConfigured ? "Live" : "not configured"}
          activeText="Running a live comparison call against OpenAI"
          inactiveText="No OPENAI_API_KEY — Compare tab shows a structural estimate"
        />
        <button
          onClick={onOpenSettings}
          title="API keys"
          aria-label="API key settings"
          className="ml-0.5 flex h-9 w-9 items-center justify-center text-2xl leading-none text-secondary transition-colors hover:text-deep"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
