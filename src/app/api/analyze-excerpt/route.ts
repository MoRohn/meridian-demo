import { NextRequest, NextResponse } from "next/server";
import { apiError, guardApi } from "@/lib/api/guard";
import { systemOne, type KeyOverride } from "@/lib/typesafe/client";
import { typesafeRequestBytes } from "@/lib/typesafe/measure";
import {
  buildExcerptQuestions,
  buildExcerptState,
  buildExcerptComplianceFlags,
  buildExcerptRisk,
  MAX_EXCERPT_CHARS,
} from "@/lib/orchestrator/excerpt";

export const runtime = "nodejs";

/**
 * TypeSafe side of highlighting text in the Document panel and asking for a
 * scoped risk/compliance read. Deliberately its own request (not bundled
 * with /api/compare-openai-excerpt) — same reasoning as the chat turn and
 * citation check: two independently-fired requests give two honest,
 * independently-timed activity indicators instead of one blended one.
 */
export async function POST(req: NextRequest) {
  const blocked = guardApi(req);
  if (blocked) return blocked;
  try {
    const body = (await req.json()) as { text?: unknown; override?: KeyOverride };
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return apiError("text is required", 400);

    const excerpt = text.slice(0, MAX_EXCERPT_CHARS);
    const questions = buildExcerptQuestions();
    const excerptState = buildExcerptState(excerpt);
    const response = await systemOne(excerptState, questions, body.override, req.signal);

    const trace = Object.entries(response.answers).map(([questionId, answer]) => ({
      questionId,
      question: questions[questionId],
      answer,
    }));

    return NextResponse.json({
      trace,
      risk: buildExcerptRisk(response.answers),
      complianceFlags: buildExcerptComplianceFlags(response.answers),
      source: response.source,
      ...(response.fallbackReason ? { fallbackReason: response.fallbackReason } : {}),
      usage: response.usage,
      elapsedMs: response.elapsedMs,
      inputBytes: typesafeRequestBytes(excerptState, questions),
    });
  } catch (err) {
    console.error("[api/analyze-excerpt] error:", err);
    return apiError("Internal error", 500);
  }
}
