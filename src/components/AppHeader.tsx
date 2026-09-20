"use client";

import { elapsedOf, formatElapsed, type ActivityActor } from "@/lib/activity/log";
import { useCurrentActivity, useNow } from "@/lib/activity/hooks";
import { Icon } from "./Icon";
import { ThemeControl } from "./ThemeControl";

/**
 * One model's timer. It shows the call running right now on that model, from zero, and when nothing is running the last
 * call that finished. Every new action is its own activity with its own start, so the timer restarts with each one; it
 * never carries a previous action's time forward, and an older call finishing late cannot take it over.
 */
function TimerPill({
  name,
  actor,
  active,
  idleLabel,
  activeText,
  inactiveText,
  hideWhenIdle = false,
  dotOnPhone = false,
}: {
  name: string;
  actor: ActivityActor;
  /** Whether this model is "on" at all right now (live model / configured) — drives the dot color. */
  active: boolean;
  idleLabel: string;
  activeText: string;
  inactiveText: string;
  /** For a model that only appears once it has done something (the judge). */
  hideWhenIdle?: boolean;
  /** Below the sm breakpoint show just the status dot (the name stays for screen readers): a third pill would not fit a phone's header. */
  dotOnPhone?: boolean;
}) {
  const activity = useCurrentActivity(actor);
  const status = activity?.status ?? "idle";
  const now = useNow(status === "pending");
  if (hideWhenIdle && !activity) return null;
  const elapsed = activity ? elapsedOf(activity, now) : null;

  // The detail is the first thing to go on a narrow header; an in-flight call is the exception, since it is live feedback.
  let detail = idleLabel;
  let detailAlwaysVisible = false;
  if (status === "pending" && elapsed != null) {
    detail = `${formatElapsed(elapsed)}…`;
    detailAlwaysVisible = true;
  } else if (status === "done" && elapsed != null) detail = `done in ${formatElapsed(elapsed)}`;
  else if (status === "error") {
    detail = `error${elapsed != null ? ` (${formatElapsed(elapsed)})` : ""}`;
    detailAlwaysVisible = true;
  }

  const dotColor =
    status === "pending" ? "bg-amber-500 animate-pulse-dot" : active ? "bg-deep" : "bg-muted";

  return (
    <div
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium tabular-nums transition-colors ${
        active || status !== "idle"
          ? "border-deep/15 bg-deep/[0.06] text-deep"
          : "border-border-strong bg-surface text-muted"
      }`}
      title={activity ? `${activity.label} · ${active ? activeText : inactiveText}` : active ? activeText : inactiveText}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
      <span className={dotOnPhone ? "sr-only sm:not-sr-only" : undefined}>
        {name.replace(/ AI$/, "")}
        <span className="hidden sm:inline">{name.endsWith(" AI") ? " AI" : ""}</span>
      </span>
      <span className={detailAlwaysVisible && !dotOnPhone ? "" : "hidden sm:inline"}>· {detail}</span>
    </div>
  );
}

export function AppHeader({
  typesafeLive,
  openaiConfigured,
  onOpenSettings,
}: {
  typesafeLive: boolean;
  openaiConfigured: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-x-3 border-b border-border bg-surface px-3 py-2 sm:px-5 sm:py-3 short:py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <svg viewBox="0 0 300 260" className="h-8 w-9 shrink-0 text-deep sm:h-9 sm:w-10" fill="currentColor" aria-label="Meridian">
          {/* Left outer leg — a vertical stroke anchored near the left edge. */}
          <path d="M 65,15 C 35,92 35,158 65,235 C 95,158 95,92 65,15 Z" />
          {/* Left arm of the middle V. */}
          <path d="M 115,70 C 93,119 116,161 150,210 C 172,161 137,119 115,70 Z" />
          {/* Right arm of the middle V. */}
          <path d="M 185,70 C 207,119 184,161 150,210 C 128,161 163,119 185,70 Z" />
          {/* Right outer leg — mirrors the left. */}
          <path d="M 235,15 C 265,92 265,158 235,235 C 205,158 205,92 235,15 Z" />
        </svg>
        <div className="min-w-0 leading-tight max-[429px]:sr-only">
          <h1 className="truncate font-serif text-lg font-extrabold tracking-tight text-deep">Meridian</h1>
          <p className="hidden text-sm font-medium text-muted md:block">AI Context Intake &amp; Contract Risk Copilot</p>
        </div>
      </div>
      {/* Wraps rather than widening the page: two live timers plus the theme and settings buttons do not fit a phone in one row. */}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <TimerPill
          name="TypeSafe AI"
          actor="typesafe"
          active={typesafeLive}
          idleLabel={typesafeLive ? "Live" : "demo mode"}
          activeText="Calling the live Jev model"
          inactiveText="No TYPESAFE_API_KEY — using the local heuristic mock"
        />
        <TimerPill
          name="OpenAI"
          actor="openai"
          active={openaiConfigured}
          idleLabel={openaiConfigured ? "Live" : "not configured"}
          activeText="Running a live comparison call against OpenAI"
          inactiveText="No OPENAI_API_KEY — Compare tab shows a structural estimate"
        />
        <TimerPill
          name="Judge"
          actor="judge"
          active
          hideWhenIdle
          dotOnPhone
          idleLabel="idle"
          activeText="The independent DeepEval judge scoring an answer"
          inactiveText="The independent DeepEval judge"
        />
        <ThemeControl />
        <button
          onClick={onOpenSettings}
          title="API keys"
          aria-label="API key settings"
          className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-deep"
        >
          <Icon name="sliders" size={20} />
        </button>
      </div>
    </header>
  );
}
