import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/memory/session";
import { buildTurnRequest } from "@/lib/orchestrator/run";
import { runOpenAIEquivalent, isOpenAIConfigured } from "@/lib/openai/client";
import { openaiAnswersToTyped } from "@/lib/openai/answers";
import { composeTurn } from "@/lib/orchestrator/compose";
import { writeReply } from "@/lib/chat/answer";
import type { OpenAITurn } from "@/lib/openai/types";
import type { KeyOverride } from "@/lib/typesafe/client";

export const runtime = "nodejs";

/**
 * A deliberately separate endpoint from /api/chat's "message" action. The
 * client fires both at the same moment (see page.tsx) so the TypeSafe and
 * OpenAI activity windows in the UI are driven by two independent network
 * requests, each resolving — and rendering — on its own. This route only
 * reads the session to reconstruct the identical question set; it never
 * mutates history or context facts, since /api/chat's "message" call is what
 * actually owns and advances the conversation.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { sessionId?: string; message?: string; override?: KeyOverride };
    if (!body?.sessionId || !body?.message?.trim()) {
      return NextResponse.json({ error: "sessionId and message are required" }, { status: 400 });
    }

    const session = getOrCreateSession(body.sessionId);
    // Snapshot BEFORE awaiting: the chat request races this one and appends to the history when it finishes, and this
    // reply must be composed from the same session state the questions were built from.
    const snapshot = { ...session, history: [...session.history], contextFacts: { ...session.contextFacts } };
    const { stateJson, questions } = buildTurnRequest(session, body.message.trim());
    const outcome = await runOpenAIEquivalent(stateJson, questions, body.override);

    // OpenAI gets a reply of its own: composed by the same pipeline as TypeSafe's, from OpenAI's answers. It quotes no
    // flag probability, because OpenAI has only a self-reported confidence and no calibrated probability to cite.
    let turn: OpenAITurn | null = null;
    if (outcome.ok) {
      const typed = openaiAnswersToTyped(outcome.result.answers, questions);
      const composed = composeTurn(snapshot, typed, { citeFlagProbability: false });
      // The same writer as TypeSafe's turn, fed OpenAI's own judgments, so the two replies differ only where the judgments do.
      const written = await writeReply({ message: body.message.trim(), session: snapshot, answers: typed, composed, citeFlagProbability: false, override: body.override });
      turn = { reply: written.reply, intent: composed.intent, risk: composed.risk, complianceFlags: composed.complianceFlags, blocked: composed.blocked, answer: written.answer };
    }

    return NextResponse.json({
      outcome,
      turn,
      questionCount: Object.keys(questions).length,
      configured: isOpenAIConfigured(body.override),
    });
  } catch (err) {
    console.error("[api/compare-openai] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
