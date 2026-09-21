"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { RubricModal, type RubricPage } from "./RubricModal";

/**
 * The one "Scoring Rubric" button every analysis page uses. It opens a scrollable modal with the rules that page is scored
 * against (the judge's rubric) and the rules Meridian applies to produce it; Trace shows all of them.
 */
export function RubricButton({ page }: { page: RubricPage }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={page === "trace" ? "How every answer is scored and decided: all rubrics and rules" : "How this is scored and decided: the scoring rubric and Meridian's rules"}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-elevated px-3 py-2.5 text-xs font-bold text-secondary transition-colors hover:border-deep/30 hover:text-deep focus-visible:outline-2 focus-visible:outline-deep lg:px-2.5 lg:py-1"
      >
        <Icon name="book" size={14} />
        Scoring Rubric
      </button>
      <RubricModal open={open} onClose={() => setOpen(false)} page={page} />
    </>
  );
}
