import { NextRequest, NextResponse } from "next/server";
import { runOpenAIEquivalent } from "@/lib/openai/client";
import type { KeyOverride } from "@/lib/typesafe/client";
import { buildExcerptQuestions, buildExcerptState, MAX_EXCERPT_CHARS } from "@/lib/orchestrator/excerpt";

export const runtime = "nodejs";

/** The OpenAI counterpart to /api/analyze-excerpt — same excerpt, same questions, fired independently. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string; override?: KeyOverride };
    const text = body?.text?.trim();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const excerpt = text.slice(0, MAX_EXCERPT_CHARS);
    const questions = buildExcerptQuestions();
    const outcome = await runOpenAIEquivalent(buildExcerptState(excerpt), questions, body.override);

    return NextResponse.json({ outcome });
  } catch (err) {
    console.error("[api/compare-openai-excerpt] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
