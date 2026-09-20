"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type WorkspaceTab = "trace" | "risk" | "compliance" | "citation";

const TABS: { id: WorkspaceTab; label: string; icon: IconName }[] = [
  { id: "trace", label: "Trace", icon: "trace" },
  { id: "risk", label: "Risk", icon: "scale" },
  { id: "compliance", label: "Compliance", icon: "shield" },
  { id: "citation", label: "Citations", icon: "search" },
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
  // flex-1, not h-full: this shares a column with the Context window bar, and h-full (100% of the column) made the panel
  // taller than the space left, clipping the bottom of every tab by exactly that bar's height.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-elevated">
      <div role="tablist" aria-label="Analysis views" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-2">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.id)}
              className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-bold transition-colors sm:flex-none lg:py-1.5 ${
                isActive ? "bg-fill text-on-fill" : "text-secondary hover:bg-surface-hover hover:text-deep"
              }`}
            >
              <Icon name={t.icon} size={16} className="max-[419px]:hidden" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={active} tabIndex={0} role="tabpanel" aria-label={`${active} results`} className="@container animate-in flex-1 overflow-y-auto p-3 pb-12 sm:p-4 sm:pb-12">
        {tabs[active]}
      </div>
    </div>
  );
}
