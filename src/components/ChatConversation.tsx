"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PillButton } from "./PillButton";
import { ChatText } from "./ChatText";
import { BACKEND_NAMES, describeTiming, finishRanks, ordinal, type ChatBackend } from "@/lib/chat/order";
import { formatElapsed } from "@/lib/activity/log";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Where an assistant reply came from ("Written by gpt-4o from the document and TypeSafe's findings"), and a caution if the model that should have written it could not. */
  via?: string | null;
  note?: string | null;
  /** Set on the replies to a question: which backend's findings this one was composed from. Each question is answered by both. */
  backend?: ChatBackend;
  /** Groups the replies to one question, so their finish order can be shown. */
  turn?: number;
  /** How long this backend took to answer, from the question being sent to its reply arriving. */
  elapsedMs?: number;
  /** The backend could not answer; `text` says why. */
  failed?: boolean;
  /** Inside `elapsedMs`: the backend's own model reasoning (its judgments), and the LLM response (the answer-writing model). Shown so the total reconciles with the Trace tab. */
  modelMs?: number;
  answerMs?: number;
}

const BACKEND_DOT: Record<ChatBackend, string> = { typesafe: "bg-deep", openai: "bg-violet-500" };

/** One backend's reply (or the wait for it): who answered, where it finished, and how long it took, above the answer itself. */
function BackendCard({ backend, rank, elapsedMs, failed, pending, children }: { backend: ChatBackend; rank?: number | null; elapsedMs?: number; failed?: boolean; pending?: boolean; children: ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-2xl rounded-bl-sm border bg-surface shadow-sm ${failed ? "border-rose-600/40" : "border-border"}`}>
      <div className="flex items-center gap-2 border-b border-border bg-elevated/60 px-3.5 py-1.5 text-xs font-bold">
        <span className={`h-2 w-2 shrink-0 rounded-full ${BACKEND_DOT[backend]}`} aria-hidden />
        <span className="text-deep">{BACKEND_NAMES[backend]}</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted">
          {pending && <span>answering…</span>}
          {failed && <span className="text-rose-800">failed</span>}
          {rank != null && (
            <span className={`rounded-full px-1.5 py-px ${rank === 1 ? "bg-fill text-on-fill" : "border border-border-strong text-secondary"}`}>{ordinal(rank)}</span>
          )}
          {elapsedMs != null && <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>}
        </span>
      </div>
      <div className="px-3.5 py-2.5 text-base font-medium leading-relaxed text-foreground">{children}</div>
    </div>
  );
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
  { label: "Check citations" },
];

export function ChatConversation({
  messages,
  onSend,
  sending,
  compact = false,
  selectedExcerpt,
  onRunExcerptAction,
  pending = [],
  openaiAvailable = true,
}: {
  messages: ChatMessage[];
  /** Backends still working on the latest question; each shows as a waiting card until its answer arrives. */
  pending?: ChatBackend[];
  /** Whether OpenAI can answer at all (a key is saved or set on the server). When it cannot, a note says only TypeSafe is answering. */
  openaiAvailable?: boolean;
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
  const ranks = finishRanks(messages);

  useEffect(() => {
    if (!compact) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending, pending.length, compact]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    onSend(draft.trim());
    setDraft("");
  }

  if (compact) {
    // The latest question's replies, in the order they arrived: with two backends answering there is more than one.
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const latest = lastUser >= 0 && lastUser < messages.length - 1 ? messages.slice(lastUser + 1) : messages.slice(-1);
    return (
      <div className="flex flex-col border-t border-border bg-surface p-3">
        {(latest.length > 0 || pending.length > 0) && (
          <div role="region" aria-label="Latest reply" tabIndex={0} className="mb-2 max-h-36 space-y-2 overflow-y-auto rounded text-xs leading-relaxed text-muted outline-none focus-visible:ring-2 focus-visible:ring-deep/50">
            {latest.map((m, i) => (
              <div key={i}>
                <span className="font-bold text-secondary">{m.role === "user" ? "You" : m.backend ? BACKEND_NAMES[m.backend] : "Meridian"}:</span>{" "}
                {m.role === "assistant" ? <ChatText text={m.text} /> : m.text}
                {m.role === "assistant" && (m.via || m.note) && (
                  <p className="mt-1 text-[11px] leading-snug">
                    {m.via}
                    {m.note && <span className={`${m.via ? "block " : ""}font-semibold text-amber-800`}>{m.note}</span>}
                  </p>
                )}
              </div>
            ))}
            {pending.map((b) => (
              <p key={b}><span className="font-bold text-secondary">{BACKEND_NAMES[b]}:</span> answering…</p>
            ))}
          </div>
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
            there to score or ask about it directly. Each question is answered by both TypeSafe and OpenAI, shown here
            in the order they finish; how each did is in the Trace tab.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex animate-in ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && !m.backend && (
              <div className="mr-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-base font-extrabold text-on-fill">
                M
              </div>
            )}
            {/* A backend's reply carries its own header instead of the avatar, so it lines up with the other replies. */}
            <div className={`flex min-w-0 flex-col ${m.backend ? "ml-10 w-full max-w-[92%]" : "max-w-[82%]"}`}>
              {m.backend ? (
                <BackendCard backend={m.backend} rank={ranks[i]} elapsedMs={m.elapsedMs} failed={m.failed}>
                  {m.failed ? m.text : <ChatText text={m.text} />}
                </BackendCard>
              ) : (
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-base font-medium leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "rounded-br-sm bg-fill text-on-fill"
                    : "rounded-bl-sm border border-border bg-surface text-foreground"
                }`}
              >
                {m.role === "assistant" ? <ChatText text={m.text} /> : m.text}
              </div>
              )}
              {m.role === "assistant" && (m.via || m.note || m.backend) && (
                <p className="mt-1 px-1 text-[11px] leading-snug text-muted">
                  {m.backend && !m.failed && describeTiming(m.backend, m, formatElapsed) && (
                    <span className="block tabular-nums">Model total {formatElapsed(m.elapsedMs ?? 0)}: {describeTiming(m.backend, m, formatElapsed)}</span>
                  )}
                  {m.via}
                  {m.note && <span className={`${m.via ? "block " : ""}font-semibold text-amber-800`}>{m.note}</span>}
                </p>
              )}
            </div>
          </div>
        ))}
        {pending.map((b) => (
          <div key={b} className="ml-10 flex w-full max-w-[92%] animate-in justify-start">
            <div className="w-full">
              <BackendCard backend={b} pending>
                <span className="flex items-center gap-1 py-1" aria-label={`${BACKEND_NAMES[b]} is answering`}>
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-deep [animation-delay:300ms]" />
                </span>
              </BackendCard>
            </div>
          </div>
        ))}
        {sending && pending.length === 0 && (
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
        {!openaiAvailable && (
          <p className="mb-1.5 text-xs font-medium text-muted">
            Only TypeSafe is answering. Save an OpenAI key in the gear-icon Settings to run every question through both models.
          </p>
        )}
        {selectedExcerpt && (
          <p className="mb-1.5 text-xs font-semibold text-accent-soft-ink">
            A passage is highlighted: Analyze/Check compliance below score just that excerpt.
          </p>
        )}
        {/* While a turn is sending every chip is disabled, and a scrolling row with nothing focusable in it cannot be reached by keyboard; so the row itself takes focus then. */}
        <div
          role="group"
          aria-label="Suggested prompts"
          tabIndex={sending ? 0 : undefined}
          className="-mx-3 mb-2 flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-0.5 focus-visible:outline-2 focus-visible:outline-deep sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
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
