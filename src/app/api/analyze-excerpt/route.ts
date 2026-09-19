import { NextRequest, NextResponse } from "next/server";
import { systemOne, type KeyOverride } from "@/lib/typesafe/client";
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
  try {
    const body = (await req.json()) as { text?: string; override?: KeyOverride };
    const text = body?.text?.trim();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const excerpt = text.slice(0, MAX_EXCERPT_CHARS);
    const questions = buildExcerptQuestions();
    const excerptState = buildExcerptState(excerpt);
    const response = await systemOne(excerptState, questions, body.override);

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
      usage: response.usage,
      elapsedMs: response.elapsedMs,
      inputBytes: Buffer.byteLength(JSON.stringify(excerptState), "utf8"),
    });
  } catch (err) {
    console.error("[api/analyze-excerpt] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
