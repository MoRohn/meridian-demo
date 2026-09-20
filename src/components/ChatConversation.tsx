"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PillButton } from "./PillButton";
import { renderBold } from "@/lib/renderBold";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * The conversation surface: messages, suggestions, and the input. Document
 * loading/upload lives in DocumentPanel now (the left column) — this
 * component only knows about the chat itself, so it works the same whether
 * a message came from the input below or from "ask about this" on a
 * highlighted excerpt in the Document panel.
 */
interface Suggestion {
  label: string;
  /** When set AND a passage is highlighted, this pill scores the highlighted excerpt (see page.tsx's handleSelectionChange) instead of sending a chat message about the whole document. */
  excerptAction?: "analyze" | "compliance";
  /** Which tab's state a whole-document run of this pill is allowed to update — keeps "Analyze" and "Check compliance" as two genuinely independent actions instead of one silently updating the other's tab. */
  scope?: "risk" | "compliance";
}

const SUGGESTIONS: Suggestion[] = [
  { label: "Analyze this contract", excerptAction: "analyze", scope: "risk" },
  { label: "Check compliance", excerptAction: "compliance", scope: "compliance" },
  { label: "Summarize this context" },
  { label: "Verify a citation" },
];

export function ChatConversation({
  messages,
  onSend,
  sending,
  compact = false,
  selectedExcerpt,
  onRunExcerptAction,
}: {
  messages: ChatMessage[];
  /** `scope` narrows which tab's state the reply updates — "Analyze" only ever touches Risk, "Check compliance" only ever touches Compliance, even though one fan-out call computes both under the hood. Free-typed messages omit it (updates whatever the reply's intent implies, same as always). */
  onSend: (text: string, scope?: "all" | "risk" | "compliance") => void;
  sending: boolean;
  /** Collapses the message history so only the input bar shows — used while the Document panel is expanded. The input stays fully usable either way. */
  compact?: boolean;
  /** The passage currently highlighted in the Document panel, if any — see page.tsx. */
  selectedExcerpt?: string | null;
  /** Scores the highlighted excerpt and focuses the tab that shows the result. Only called when a passage is highlighted; otherwise the pill falls through to a normal full-document chat message. */
  onRunExcerptAction?: (kind: "analyze" | "compliance") => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending, compact]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    onSend(draft.trim());
    setDraft("");
  }

  if (compact) {
    const last = messages[messages.length - 1];
    return (
      <div className="flex flex-col border-t border-border bg-surface p-3">
        {last && (
          <p className="mb-2 max-h-24 overflow-y-auto text-xs leading-relaxed text-muted">
            <span className="font-bold text-secondary">{last.role === "user" ? "You" : "Meridian"}:</span> {last.text}
          </p>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about the context…"
            className="flex-1 rounded-full border border-border-strong bg-background px-4 py-2.5 text-base font-medium text-foreground placeholder:text-muted focus:border-deep focus:outline-none"
          />
          <PillButton type="submit" disabled={sending || !draft.trim()} variant="deep">
            Send
          </PillButton>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div ref={scrollRef} tabIndex={0} role="log" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto px-4 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_28px)]">
        {messages.length === 0 && (
          <div className="animate-in rounded-2xl border border-dashed border-border-strong bg-surface p-4 text-base font-medium leading-relaxed text-secondary">
            Load or upload a document on the left, then ask the assistant to analyze it — or highlight any passage
            there to score or ask about it directly. Every reply is composed from typed, probability-scored
            judgments, visible in the Trace tab below.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex animate-in ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="mr-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-base font-extrabold text-on-fill">
                M
              </div>
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-base font-medium leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "rounded-br-sm bg-fill text-on-fill"
                  : "rounded-bl-sm border border-border bg-surface text-foreground"
              }`}
            >
              {m.role === "assistant" ? renderBold(m.text) : m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex animate-in justify-start">
            <div className="mr-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-base font-extrabold text-on-fill">
              M
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-surface p-3 short:py-2">
        {selectedExcerpt && (
          <p className="mb-1.5 text-xs font-semibold text-accent-soft-ink">
            A passage is highlighted: Analyze/Check compliance below score just that excerpt.
          </p>
        )}
        <div className="-mx-3 mb-2 flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {SUGGESTIONS.map((s) => {
            const runsOnExcerpt = Boolean(s.excerptAction && selectedExcerpt);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (s.excerptAction && selectedExcerpt && onRunExcerptAction) {
                    onRunExcerptAction(s.excerptAction);
                  } else {
                    onSend(s.label, s.scope);
                  }
                }}
                disabled={sending}
                title={runsOnExcerpt ? "Scores the highlighted excerpt" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2.5 text-sm font-semibold lg:py-1.5 transition-colors disabled:opacity-40 ${
                  runsOnExcerpt
                    ? "border-accent/50 bg-accent-soft text-accent-soft-ink hover:border-accent"
                    : "border-border-strong text-secondary hover:border-deep/30 hover:text-deep"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about the context…"
            className="flex-1 rounded-full border border-border-strong bg-background px-4 py-2.5 text-base font-medium text-foreground placeholder:text-muted focus:border-deep focus:outline-none"
          />
          <PillButton type="submit" disabled={sending || !draft.trim()} variant="deep">
            Send
          </PillButton>
        </form>
      </div>
    </div>
  );
}
