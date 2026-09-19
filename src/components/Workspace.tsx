"use client";

import type { ReactNode } from "react";

export type WorkspaceTab = "trace" | "risk" | "compliance" | "citation";

const TABS: { id: WorkspaceTab; label: string; icon: string }[] = [
  { id: "trace", label: "Trace", icon: "🧠" },
  { id: "risk", label: "Risk", icon: "⚖️" },
  { id: "compliance", label: "Compliance", icon: "🛡️" },
  { id: "citation", label: "Citations", icon: "🔎" },
];

/**
 * The analysis tabs — Document has its own dedicated column now (see
 * DocumentPanel / page.tsx), so this only covers judgments, not the source
 * text. There's no separate "vs OpenAI" tab either: every tab here
 * (Trace, Risk, Compliance, Citations) shows OpenAI's answer to the
 * identical question right next to TypeSafe's — see
 * src/lib/compare/agreement.ts.
 */
export function Workspace({
  active,
  onChange,
  tabs,
}: {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  tabs: Record<WorkspaceTab, ReactNode>;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-elevated">
      <div className="flex min-w-0 flex-wrap gap-1 border-b border-border bg-surface px-2 py-2">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition-colors ${
                isActive ? "bg-deep text-accent" : "text-secondary hover:bg-surface-hover hover:text-deep"
              }`}
            >
              <span aria-hidden className="text-base">
                {t.icon}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={active} className="animate-in flex-1 overflow-y-auto p-4 pb-8">
        {tabs[active]}
      </div>
    </div>
  );
}
