import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/memory/session";
import { buildTurnRequest } from "@/lib/orchestrator/run";
import { runOpenAIEquivalent, isOpenAIConfigured } from "@/lib/openai/client";
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
    const { stateJson, questions } = buildTurnRequest(session, body.message.trim());
    const outcome = await runOpenAIEquivalent(stateJson, questions, body.override);

    return NextResponse.json({
      outcome,
      questionCount: Object.keys(questions).length,
      configured: isOpenAIConfigured(body.override),
    });
  } catch (err) {
    console.error("[api/compare-openai] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
