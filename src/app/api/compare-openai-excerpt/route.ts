import { NextRequest, NextResponse } from "next/server";
import { apiError, guardApi } from "@/lib/api/guard";
import { runOpenAIEquivalent } from "@/lib/openai/client";
import type { KeyOverride } from "@/lib/typesafe/client";
import { buildExcerptQuestions, buildExcerptState, MAX_EXCERPT_CHARS } from "@/lib/orchestrator/excerpt";

export const runtime = "nodejs";

/** The OpenAI counterpart to /api/analyze-excerpt — same excerpt, same questions, fired independently. */
export async function POST(req: NextRequest) {
  const blocked = guardApi(req);
  if (blocked) return blocked;
  try {
    const body = (await req.json()) as { text?: unknown; override?: KeyOverride };
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return apiError("text is required", 400);

    const excerpt = text.slice(0, MAX_EXCERPT_CHARS);
    const questions = buildExcerptQuestions();
    const outcome = await runOpenAIEquivalent(buildExcerptState(excerpt), questions, body.override);

    return NextResponse.json({ outcome });
  } catch (err) {
    console.error("[api/compare-openai-excerpt] error:", err);
    return apiError("Internal error", 500);
  }
}
