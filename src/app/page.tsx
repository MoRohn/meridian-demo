"use client";

import { useEffect, useMemo, useState } from "react";
import { DocumentPanel } from "@/components/DocumentPanel";
import { ChatConversation, type ChatMessage } from "@/components/ChatConversation";
import { MobileNav, type MobileView } from "@/components/MobileNav";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { evalStore } from "@/lib/eval/store";
import { citationStore } from "@/lib/citations/store";
import { buildReportDoc, reportFilename } from "@/lib/report/buildReport";
import type { ReportFormat } from "@/lib/report/doc";
import { renderReport } from "@/lib/report/formats";
import { downloadBlob } from "@/lib/report/download";
import { AppHeader } from "@/components/AppHeader";
import { activityLog, type ActivityFinish, type ActivityKind } from "@/lib/activity/log";
import { describeAnswer, openaiActivityResult, typesafeActivityResult, writerActivityResult } from "@/lib/activity/outcomes";
import type { TurnAnswer } from "@/lib/chat/answer";
import { Workspace, type WorkspaceTab } from "@/components/Workspace";
import { ReasoningTrace } from "@/components/ReasoningTrace";
import { RiskDashboard } from "@/components/RiskDashboard";
import { ComplianceFlags } from "@/components/ComplianceFlags";
import { CitationVerifier } from "@/components/CitationVerifier";
import type { TraceEntry, ComplianceFlag, ContextStats } from "@/lib/orchestrator/run";
import { ContextMeter, type BackendContextMetrics } from "@/components/ContextMeter";
import type { CompositeRisk } from "@/lib/skills/clauseRisk";
import type { OpenAIRunOutcome, OpenAITurn } from "@/lib/openai/types";
import { CONTRACT_TYPES } from "@/lib/skills/contractType";
import { TYPESAFE_PRICING, usdForTokens, type SessionTotals } from "@/lib/compare/pricing";
import { matchReferencePrice } from "@/lib/compare/openaiEquivalent";
import { SettingsModal } from "@/components/SettingsModal";
import { loadSettings, saveSettings, typesafeOverride, openaiOverride, type ApiKeySettings } from "@/lib/settings";

interface ContextFacts {
  contractType?: string;
  jurisdiction?: string;
}
interface ActiveDocument {
  id: string;
  name: string;
  text: string;
}

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function callApi(body: Record<string, unknown>) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
  return res.json();
}

const emptyTotals: SessionTotals = {
  turns: 0,
  typesafe: { calls: 0, inputTokens: 0, costUsd: 0 },
  openai: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
};

export default function Home() {
  const [sessionId] = useState(newSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);
  const [contextFacts, setContextFacts] = useState<ContextFacts>({});
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("trace");
  const [documentExpanded, setDocumentExpanded] = useState(false);

  const [trace, setTrace] = useState<TraceEntry[]>([]);
  /** Which pane is showing below the lg breakpoint; the two-column desktop layout ignores it. */
  const [mobileView, setMobileView] = useState<MobileView>("assistant");
  const [seenVersions, setSeenVersions] = useState({ analysis: 0, assistant: 0 });
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [traceSource, setTraceSource] = useState<"live" | "mock">("mock");
  /** The judgments the last chat reply was composed from (not scope-filtered), so the reply can be checked against them. */
  const [lastJudgments, setLastJudgments] = useState<{ risk: CompositeRisk | null; flags: ComplianceFlag[] } | null>(null);
  const [risk, setRisk] = useState<CompositeRisk | null>(null);
  const [complianceFlags, setComplianceFlags] = useState<ComplianceFlag[]>([]);
  /** Whatever chat message most recently produced the Trace tab's content — re-run by the Trace tab's retry button. */
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  /** The composed reply behind the current Trace tab content — evaluated by the DeepEval panel there. */
  const [lastReply, setLastReply] = useState<string | null>(null);
  /** Real, measured size/window-usage of the state sent on the last chat turn — see ContextMeter.tsx. */
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  /** Each backend's own measured input/output size on whichever action last ran for it — updated independently per backend, same spirit as the header activity pills. */
  const [typesafeMetrics, setTypesafeMetrics] = useState<BackendContextMetrics | null>(null);
  const [openaiMetrics, setOpenaiMetrics] = useState<BackendContextMetrics | null>(null);

  const [openaiOutcome, setOpenaiOutcome] = useState<OpenAIRunOutcome | null>(null);
  /** The reply Meridian composed from OpenAI's answers to the latest chat turn, so OpenAI's reply can be evaluated like TypeSafe's. */
  const [openaiTurn, setOpenaiTurn] = useState<OpenAITurn | null>(null);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);

  // Highlighted-excerpt analysis — scoped separately from the whole-document
  // risk/compliance state above so highlighting a passage never clobbers the
  // full-document judgments. Rendered as an "Excerpt" section inside the
  // existing Risk and Compliance tabs (see RiskDashboard.tsx / ComplianceFlags.tsx).
  const [selectedExcerpt, setSelectedExcerpt] = useState<string | null>(null);
  const [excerptStatus, setExcerptStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [excerptRisk, setExcerptRisk] = useState<CompositeRisk | null>(null);
  /** Whether the highlighted-excerpt TypeSafe answer came from the live model or the local demo heuristic. */
  const [excerptSource, setExcerptSource] = useState<"live" | "mock" | null>(null);
  const [excerptComplianceFlags, setExcerptComplianceFlags] = useState<ComplianceFlag[]>([]);
  const [excerptOaOutcome, setExcerptOaOutcome] = useState<OpenAIRunOutcome | null>(null);

  const [sessionTotals, setSessionTotals] = useState<SessionTotals>(emptyTotals);

  // Every model call is its own record in the activity log (src/lib/activity/log.ts), with its own start time. The header
  // timers, the activity windows and the activity trace all read from it, so each action starts a fresh timer from zero
  // and a slow older call finishing late can only ever update its own record, never a newer action's timer.
  function beginTypesafeActivity(kind: ActivityKind, label: string): number {
    return activityLog.begin("typesafe", kind, label);
  }
  function finishTypesafeActivity(id: number, result: ActivityFinish) {
    activityLog.finish(id, result);
  }
  function beginOpenaiActivity(kind: ActivityKind, label: string): number {
    return activityLog.begin("openai", kind, label);
  }
  function finishOpenaiActivity(id: number, result: ActivityFinish) {
    activityLog.finish(id, result);
  }

  /**
   * A model-written answer is its own activity, timed and priced apart from the backend whose findings it was written
   * from, so neither TypeSafe's nor OpenAI's speed and cost figures ever include the writing.
   */
  function logWrittenAnswer(answer: TurnAnswer | null | undefined, backendName: string) {
    const finished = writerActivityResult(answer);
    if (!finished) return;
    const id = activityLog.begin("writer", "answer", `Answer from ${backendName}'s findings`, Date.now() - (answer?.elapsedMs ?? 0));
    activityLog.finish(id, finished);
  }

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [apiKeySettings, setApiKeySettings] = useState<ApiKeySettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tsOverride = useMemo(() => typesafeOverride(apiKeySettings), [apiKeySettings]);
  const oaOverride = useMemo(() => openaiOverride(apiKeySettings), [apiKeySettings]);

  // Whether a user-supplied key was actually confirmed to work (a real,
  // cheap "list models" round trip — see /api/validate-keys), not just
  // present. `null` means "no user key to validate" — the header pill then
  // falls back to the server's env-based live/openaiConfigured flags below.
  const [typesafeKeyValid, setTypesafeKeyValid] = useState<boolean | null>(null);
  const [openaiKeyValid, setOpenaiKeyValid] = useState<boolean | null>(null);

  async function validateKeys(settings: ApiKeySettings) {
    const tOverride = typesafeOverride(settings);
    const oOverride = openaiOverride(settings);
    if (!tOverride) setTypesafeKeyValid(null);
    if (!oOverride) setOpenaiKeyValid(null);
    if (!tOverride && !oOverride) return;
    try {
      const res = await fetch("/api/validate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typesafeOverride: tOverride, openaiOverride: oOverride }),
      });
      const data = await res.json();
      if (tOverride) setTypesafeKeyValid(Boolean(data.typesafeValid));
      if (oOverride) setOpenaiKeyValid(Boolean(data.openaiValid));
    } catch {
      if (tOverride) setTypesafeKeyValid(false);
      if (oOverride) setOpenaiKeyValid(false);
    }
  }

  function handleSaveSettings(next: ApiKeySettings) {
    setApiKeySettings(next);
    saveSettings(next);
    void validateKeys(next);
  }

  // The pill shows "Live" the moment a saved key is confirmed valid — a
  // user-supplied key that hasn't been validated yet (or failed validation)
  // never overstates itself as live; it just falls back to whatever the
  // server's env-based key already reports.
  const effectiveTypesafeLive = tsOverride ? typesafeKeyValid === true : live;
  const effectiveOpenaiConfigured = oaOverride ? openaiKeyValid === true : openaiConfigured;

  useEffect(() => {
    callApi({ action: "reset", sessionId, typesafeOverride: tsOverride, openaiOverride: oaOverride })
      .then((data) => {
        setLive(Boolean(data.live));
        setOpenaiConfigured(Boolean(data.openaiConfigured));
      })
      .catch(() => {});
    // Deferred a tick so the synchronous setState(null) branches inside
    // validateKeys (for "no override configured") don't run directly in the
    // effect body — only the async network path should land here.
    Promise.resolve().then(() => validateKeys(apiKeySettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Fires the two backends as genuinely independent requests, at the same
   * moment, rather than bundling the OpenAI comparison into the chat
   * response. Each promise updates its own status/state the instant IT
   * resolves — the TypeSafe and OpenAI columns on every analysis tab are
   * driven by two separate fetches racing each other in real time.
   */
  async function handleSend(text: string, scope: "all" | "risk" | "compliance" = "all") {
    setMessages((m) => [...m, { role: "user", text }]);
    setLastMessage(text);
    setOpenaiTurn(null); // never pair a new TypeSafe reply with OpenAI's reply to the previous message
    setSending(true);
    const tsEpoch = beginTypesafeActivity("chat", text);
    const oaEpoch = openaiConfigured ? beginOpenaiActivity("chat", text) : null;

    const chatPromise = callApi({
      action: "message",
      sessionId,
      message: text,
      typesafeOverride: tsOverride,
      openaiOverride: oaOverride,
    })
      .then((data) => {
        const result = data.result as {
          reply: string;
          trace: TraceEntry[];
          source: "live" | "mock";
          risk: CompositeRisk | null;
          complianceFlags: ComplianceFlag[];
          usage: { input_tokens: number; output_tokens: number };
          elapsedMs: number;
          context: ContextStats;
          answer: TurnAnswer;
        };
        const { via, note } = describeAnswer(result.answer, "TypeSafe");
        setMessages((m) => [...m, { role: "assistant", text: result.reply, via, note }]);
        logWrittenAnswer(result.answer, "TypeSafe");
        setLastReply(result.reply);
        setTrace(result.trace);
        setTraceSource(result.source);
        setLastJudgments({ risk: result.risk, flags: result.complianceFlags ?? [] });
        // A tab's own action button only ever touches that tab's state — the
        // Risk rerun never silently updates Compliance's flags and vice
        // versa, even though one fan-out call computes both under the hood.
        if (result.risk && scope !== "compliance") setRisk(result.risk);
        if (result.complianceFlags?.length && scope !== "risk") setComplianceFlags(result.complianceFlags);
        setContextStats(result.context);
        setTypesafeMetrics({
          task: text,
          inputBytes: result.context.bytes,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        });
        finishTypesafeActivity(tsEpoch, typesafeActivityResult(result.source, result.elapsedMs, result.usage));
        setLive(Boolean(data.live));
        setOpenaiConfigured(Boolean(data.openaiConfigured));
        setContextFacts(data.session?.contextFacts ?? {});

        // The mock evaluator (no TYPESAFE_API_KEY) answers locally and bills
        // nothing — only a genuinely live call incurs real cost. Token counts
        // still accumulate either way (they reflect real context size), but
        // cost must not.
        const typesafeCost =
          result.source === "live" ? usdForTokens(result.usage.input_tokens, TYPESAFE_PRICING.inputPerMillionUsd) : 0;
        setSessionTotals((prev) => ({
          ...prev,
          turns: prev.turns + 1,
          typesafe: {
            calls: prev.typesafe.calls + 1,
            inputTokens: prev.typesafe.inputTokens + result.usage.input_tokens,
            costUsd: prev.typesafe.costUsd + typesafeCost,
          },
        }));
      })
      .catch((err) => {
        finishTypesafeActivity(tsEpoch, { status: "error", note: (err as Error).message });
        setMessages((m) => [...m, { role: "assistant", text: `Error: ${(err as Error).message}` }]);
      })
      .finally(() => setSending(false));

    const openaiPromise =
      openaiConfigured && oaEpoch != null
        ? fetch("/api/compare-openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, message: text, override: oaOverride }),
          })
            .then((r) => r.json())
            .then((data: { outcome: OpenAIRunOutcome; turn?: OpenAITurn | null }) => {
              const outcome = data.outcome;
              setOpenaiOutcome(outcome);
              setOpenaiTurn(data.turn ?? null);
              finishOpenaiActivity(oaEpoch, openaiActivityResult(outcome));
              logWrittenAnswer(data.turn?.answer, "OpenAI");
              if (outcome?.ok) {
                const result = outcome.result;
                setOpenaiMetrics({
                  task: text,
                  inputBytes: result.requestBytes,
                  inputTokens: result.usage.input_tokens,
                  outputTokens: result.usage.output_tokens,
                });
                const price = matchReferencePrice(result.model);
                const cost =
                  usdForTokens(result.usage.input_tokens, price.inputPerMillionUsd) +
                  usdForTokens(result.usage.output_tokens, price.outputPerMillionUsd);
                setSessionTotals((prev) => ({
                  ...prev,
                  openai: {
                    calls: prev.openai.calls + 1,
                    inputTokens: prev.openai.inputTokens + result.usage.input_tokens,
                    outputTokens: prev.openai.outputTokens + result.usage.output_tokens,
                    costUsd: prev.openai.costUsd + cost,
                  },
                }));
              }
            })
            .catch((err) => {
              finishOpenaiActivity(oaEpoch, { status: "error", note: (err as Error).message });
            })
        : Promise.resolve();

    // Both fire immediately above; we only await the chat call for the
    // "sending" spinner — the OpenAI window keeps updating in the
    // background even after the user is free to send the next message.
    void openaiPromise;
    await chatPromise;
  }

  /**
   * Highlighting a passage in the Document panel doesn't open any new UI —
   * it runs the same risk/compliance judgments scoped to just that excerpt,
   * and the result shows up in the existing Risk and Compliance tabs
   * (see RiskDashboard.tsx / ComplianceFlags.tsx), the same tab buttons
   * already used for whole-document analysis. Triggered directly from the
   * selection event in DocumentPanel, not a `useEffect` watching a prop —
   * this is a real event handler, not a derived-state reset.
   */
  async function handleSelectionChange(text: string | null) {
    setSelectedExcerpt(text);
    if (!text) {
      setExcerptStatus("idle");
      setExcerptRisk(null);
      setExcerptComplianceFlags([]);
      setExcerptOaOutcome(null);
      return;
    }

    setExcerptStatus("pending");
    const tsEpoch = beginTypesafeActivity("excerpt", "Excerpt scan");
    const oaEpoch = openaiConfigured ? beginOpenaiActivity("excerpt", "Excerpt scan") : null;

    const tsPromise = fetch("/api/analyze-excerpt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, override: tsOverride }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setExcerptRisk(data.risk);
        setExcerptSource(data.source === "live" ? "live" : "mock");
        setExcerptComplianceFlags(data.complianceFlags ?? []);
        setExcerptStatus("done");
        setTypesafeMetrics({
          task: "Excerpt scan",
          inputBytes: data.inputBytes,
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        });
        finishTypesafeActivity(tsEpoch, typesafeActivityResult(data.source === "live" ? "live" : "mock", data.elapsedMs, data.usage));
      })
      .catch((err) => {
        setExcerptStatus("error");
        finishTypesafeActivity(tsEpoch, { status: "error", note: (err as Error).message });
      });

    const oaPromise =
      openaiConfigured && oaEpoch != null
        ? fetch("/api/compare-openai-excerpt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, override: oaOverride }),
          })
            .then((r) => r.json())
            .then((data: { outcome: OpenAIRunOutcome }) => {
              const outcome = data.outcome;
              setExcerptOaOutcome(outcome);
              if (outcome?.ok) {
                setOpenaiMetrics({
                  task: "Excerpt scan",
                  inputBytes: outcome.result.requestBytes,
                  inputTokens: outcome.result.usage.input_tokens,
                  outputTokens: outcome.result.usage.output_tokens,
                });
              }
              finishOpenaiActivity(oaEpoch, openaiActivityResult(outcome));
            })
            .catch((err) => finishOpenaiActivity(oaEpoch, { status: "error", note: (err as Error).message }))
        : Promise.resolve();

    await Promise.all([tsPromise, oaPromise]);
  }

  /**
   * The chat window's "Analyze this contract" / "Check compliance" pills:
   * when a passage is highlighted, they re-run the excerpt scoring (rather
   * than sending a chat message about the whole document) and jump to
   * whichever tab shows that kind of result — same underlying call as
   * highlighting itself, just re-triggerable from a button instead of only
   * firing once on mouseup.
   */
  function handleRunExcerptAction(kind: "analyze" | "compliance") {
    if (!selectedExcerpt) return;
    setActiveTab(kind === "analyze" ? "risk" : "compliance");
    selectMobileView("analysis");
    void handleSelectionChange(selectedExcerpt);
  }

  /**
   * The retry icon on the Trace/Risk/Compliance tabs: re-scans whichever
   * scope produced what's currently on screen — the highlighted excerpt if
   * one is selected, otherwise the whole document — without the reader
   * having to retype a chat message. Trace always re-runs the last message
   * actually sent, since a chat turn (not excerpt highlighting) is the only
   * thing that populates it.
   */
  function handleRerunTrace() {
    if (lastMessage) void handleSend(lastMessage);
  }
  function handleRerunRisk() {
    if (selectedExcerpt) void handleSelectionChange(selectedExcerpt);
    else void handleSend("Analyze this contract", "risk");
  }
  function handleRerunCompliance() {
    if (selectedExcerpt) void handleSelectionChange(selectedExcerpt);
    else void handleSend("Check compliance", "compliance");
  }

  async function handleLoadDocument(contractId: string) {
    setSending(true);
    try {
      const data = await callApi({
        action: "load_document",
        sessionId,
        contractId,
        typesafeOverride: tsOverride,
        openaiOverride: oaOverride,
      });
      setActiveDocument(data.session.activeDocument);
      setDocumentExpanded(true); // a document that has just been chosen or uploaded opens filling the left panel
      setContextFacts(data.session.contextFacts ?? {});
      setRisk(null);
      setComplianceFlags([]);
      setSelectedExcerpt(null);
      setExcerptStatus("idle");
      setExcerptRisk(null);
      setExcerptComplianceFlags([]);
      setExcerptOaOutcome(null);
      setLive(Boolean(data.live));
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Loaded "${data.session.activeDocument.name}" as the active document.` },
      ]);
      // A freshly loaded document is a blank slate — analyze it immediately
      // rather than waiting for the reader to click a pill or type a message.
      await handleSend("Analyze this contract");
    } finally {
      setSending(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const extracted = await res.json();
      if (!res.ok) throw new Error(extracted?.error ?? "Upload failed");

      const data = await callApi({
        action: "load_document_text",
        sessionId,
        name: extracted.name,
        text: extracted.text,
        typesafeOverride: tsOverride,
        openaiOverride: oaOverride,
      });
      setActiveDocument(data.session.activeDocument);
      setDocumentExpanded(true); // a document that has just been chosen or uploaded opens filling the left panel
      setContextFacts(data.session.contextFacts ?? {});
      setRisk(null);
      setComplianceFlags([]);
      setSelectedExcerpt(null);
      setExcerptStatus("idle");
      setExcerptRisk(null);
      setExcerptComplianceFlags([]);
      setExcerptOaOutcome(null);
      setLive(Boolean(data.live));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Loaded "${extracted.name}"${extracted.truncated ? " (truncated to fit the model's context budget)" : ""} as the active document.`,
        },
      ]);
      // A freshly loaded document is a blank slate — analyze it immediately
      // rather than waiting for the reader to click a pill or type a message.
      await handleSend("Analyze this contract");
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleReset() {
    setSending(true);
    try {
      const data = await callApi({ action: "reset", sessionId, typesafeOverride: tsOverride, openaiOverride: oaOverride });
      setMessages([]);
      setActiveDocument(null);
      setContextFacts({});
      setTrace([]);
      setRisk(null);
      setComplianceFlags([]);
      setOpenaiOutcome(null);
      setOpenaiTurn(null);
      evalStore.reset(); // a new session gets its first-time evaluations again
      citationStore.reset();
      setLastMessage(null);
      setLastReply(null);
      setContextStats(null);
      setTypesafeMetrics(null);
      setOpenaiMetrics(null);
      // Clearing the log also orphans any still-in-flight call from before the reset: when it lands, its record is gone,
      // so it can no longer write a stale "done"/"error" over this idle state.
      activityLog.reset();
      setSelectedExcerpt(null);
      setExcerptStatus("idle");
      setExcerptRisk(null);
      setExcerptComplianceFlags([]);
      setExcerptOaOutcome(null);
      setUploadError(null);
      setSessionTotals(emptyTotals);
      setLive(Boolean(data.live));
      setOpenaiConfigured(Boolean(data.openaiConfigured));
      setActiveTab("trace");
      setDocumentExpanded(false);
    } finally {
      setSending(false);
    }
  }

  function handleCitationMetrics(actor: "typesafe" | "openai", metrics: BackendContextMetrics) {
    if (actor === "typesafe") setTypesafeMetrics(metrics);
    else setOpenaiMetrics(metrics);
  }

  const contractTypeLabel = useMemo(() => {
    if (!contextFacts.contractType) return null;
    return CONTRACT_TYPES[contextFacts.contractType as keyof typeof CONTRACT_TYPES] ?? contextFacts.contractType;
  }, [contextFacts.contractType]);

  // A monotonic "something new" counter per pane; the dot shows while the pane's
  // counter is ahead of what the reader last saw there.
  const analysisVersion = sessionTotals.turns + (excerptStatus === "done" ? 1 : 0);
  const assistantVersion = messages.length;
  function selectMobileView(next: MobileView) {
    setSeenVersions((seen) => ({
      analysis: next === "analysis" || mobileView === "analysis" ? analysisVersion : seen.analysis,
      assistant: next === "assistant" || mobileView === "assistant" ? assistantVersion : seen.assistant,
    }));
    setMobileView(next);
  }
  const mobileBadges = {
    analysis: analysisVersion !== seenVersions.analysis,
    assistant: assistantVersion !== seenVersions.assistant,
  };
  // "Expanded" is a desktop-only affordance; on small screens the document pane already has the whole screen.
  const documentFillsColumn = documentExpanded && isDesktop;

  async function handleDownloadReport(format: ReportFormat) {
    const at = Date.now();
    const document = activeDocument ? { name: activeDocument.name, contractType: contractTypeLabel } : null;
    const doc = buildReportDoc({ generatedAt: at, document, evals: evalStore.rows(), activities: activityLog.list(), trace });
    downloadBlob(reportFilename(document, at, format), await renderReport(doc, format));
  }

  const contextBar = (
    <section aria-label="Session context" className="flex min-w-0 items-center gap-x-3 gap-y-1.5 border-b border-border bg-surface px-4 py-2 text-sm short:hidden sm:gap-x-5 sm:py-2.5">
      <span className="hidden shrink-0 font-bold uppercase tracking-wide text-muted xl:inline">Context memory</span>
      <ContextFact label="doc" value={activeDocument ? activeDocument.name : "none loaded"} grow />
      <span className="hidden min-w-0 sm:flex">
        <ContextFact label="type" value={contractTypeLabel ?? "not yet classified"} />
      </span>
      <ContextFact label="turns" value={String(messages.length)} />
    </section>
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <AppHeader
        typesafeLive={effectiveTypesafeLive}
        openaiConfigured={effectiveOpenaiConfigured}
        onOpenSettings={() => setSettingsOpen(true)}
        onDownloadReport={handleDownloadReport}
      />
      <SettingsModal
        open={settingsOpen}
        settings={apiKeySettings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
      {contextBar}
      <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-border lg:flex lg:border-r ${mobileView === "analysis" ? "hidden" : "flex"}`}>
          <div
            className={`min-h-0 overflow-hidden border-border lg:block lg:border-b ${
              mobileView === "document" ? "block flex-1" : "hidden"
            } ${documentFillsColumn ? "lg:flex-1" : "lg:flex-[0_0_55%]"}`}
          >
            <DocumentPanel
              document={activeDocument}
              activeDocumentId={activeDocument?.id ?? null}
              onLoadDocument={handleLoadDocument}
              onUpload={handleUpload}
              uploading={uploading}
              uploadError={uploadError}
              onReset={handleReset}
              selectedExcerpt={selectedExcerpt}
              onSelectionChange={handleSelectionChange}
              expanded={documentFillsColumn}
              onToggleExpand={() => setDocumentExpanded((e) => !e)}
            />
          </div>
          {/* The chat input stays usable no matter what — only the message history collapses while the document is expanded. */}
          <div className={`lg:block ${mobileView === "assistant" ? "block" : "hidden"} ${documentFillsColumn ? "shrink-0" : "min-h-0 flex-1 overflow-hidden"}`}>
            <ChatConversation
              messages={messages}
              onSend={handleSend}
              sending={sending}
              compact={documentFillsColumn}
              selectedExcerpt={selectedExcerpt}
              onRunExcerptAction={handleRunExcerptAction}
            />
          </div>
        </div>
        <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex ${mobileView === "analysis" ? "flex" : "hidden"}`}>
          <ContextMeter stats={contextStats} typesafeMetrics={typesafeMetrics} openaiMetrics={openaiMetrics} />
          <Workspace
            active={activeTab}
            onChange={setActiveTab}
            tabs={{
                trace: (
                  <ReasoningTrace
                    trace={trace}
                    source={traceSource}
                    openaiOutcome={openaiOutcome}
                    openaiConfigured={openaiConfigured}
                    onRerun={lastMessage ? handleRerunTrace : undefined}
                    rerunPending={sending}
                    lastMessage={lastMessage}
                    lastReply={lastReply}
                    documentText={activeDocument?.text}
                    judgments={lastJudgments}
                    openaiTurn={openaiTurn}
                  />
                ),
                risk: (
                  <RiskDashboard
                    risk={risk}
                    hasDocument={Boolean(activeDocument)}
                    documentText={activeDocument?.text}
                    openaiOutcome={openaiOutcome}
                    openaiConfigured={openaiConfigured}
                    selectedExcerpt={selectedExcerpt}
                    excerptStatus={excerptStatus}
                    excerptRisk={excerptRisk}
                    typesafeSource={traceSource}
                    excerptTypesafeSource={excerptSource}
                    excerptOpenaiOutcome={excerptOaOutcome}
                    onRerun={handleRerunRisk}
                    rerunPending={selectedExcerpt ? excerptStatus === "pending" : sending}
                  />
                ),
                compliance: (
                  <ComplianceFlags
                    flags={complianceFlags}
                    hasDocument={Boolean(activeDocument)}
                    documentText={activeDocument?.text}
                    openaiOutcome={openaiOutcome}
                    openaiConfigured={openaiConfigured}
                    selectedExcerpt={selectedExcerpt}
                    excerptStatus={excerptStatus}
                    typesafeSource={traceSource}
                    excerptTypesafeSource={excerptSource}
                    excerptFlags={excerptComplianceFlags}
                    excerptOpenaiOutcome={excerptOaOutcome}
                    onRerun={handleRerunCompliance}
                    rerunPending={selectedExcerpt ? excerptStatus === "pending" : sending}
                  />
                ),
                citation: (
                  <CitationVerifier
                    documentKey={activeDocument?.id}
                    documentName={activeDocument?.name}
                    documentText={activeDocument?.text}
                    selectedExcerpt={selectedExcerpt}
                    openaiConfigured={effectiveOpenaiConfigured}
                    typesafeOverride={tsOverride}
                    openaiOverride={oaOverride}
                    onBeginTypesafeActivity={beginTypesafeActivity}
                    onFinishTypesafeActivity={finishTypesafeActivity}
                    onBeginOpenaiActivity={beginOpenaiActivity}
                    onFinishOpenaiActivity={finishOpenaiActivity}
                    onTypesafeMetrics={(m) => handleCitationMetrics("typesafe", m)}
                    onOpenaiMetrics={(m) => handleCitationMetrics("openai", m)}
                  />
                ),
              }}
            />
        </div>
      </main>
      <MobileNav active={mobileView} onChange={selectMobileView} badges={mobileBadges} />
    </div>
  );
}

function ContextFact({ label, value, grow }: { label: string; value: string; grow?: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-1 font-medium text-secondary ${grow ? "flex-1 basis-32" : "shrink-0"}`}>
      <span className="shrink-0 text-muted">{label}:</span>
      <span
        title={value}
        className={`truncate font-bold text-foreground ${grow ? "max-w-[8rem] sm:max-w-[14rem] md:max-w-[22rem]" : "max-w-[11rem] sm:max-w-[16rem] lg:max-w-[30rem]"}`}
      >
        {value}
      </span>
    </span>
  );
}
